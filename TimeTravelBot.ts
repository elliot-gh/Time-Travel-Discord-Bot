import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction, Client, Message, GatewayIntentBits, ChatInputCommandInteraction, EmbedBuilder,
    ContextMenuCommandBuilder, ApplicationCommandType, MessageContextMenuCommandInteraction } from "discord.js";
import axios from "axios";
import { find } from "linkifyjs";
import { BotInterface } from "../../BotInterface";
import { readYamlConfig } from "../../utils/ConfigUtils";
import { TimeTravelConfig } from "./TimeTravelConfig";

export class TimeTravelBot implements BotInterface {
    intents: GatewayIntentBits[];
    commands: (SlashCommandBuilder | ContextMenuCommandBuilder)[];

    private static readonly OPT_URL = "url";
    private slashTimeTravel!: SlashCommandBuilder;
    private contextTimeTravel!: ContextMenuCommandBuilder;
    private config!: TimeTravelConfig;

    constructor() {
        this.intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
        this.slashTimeTravel = new SlashCommandBuilder()
            .setName("timetravel")
            .setDescription("Tries to find an archived version of a URL.")
            .addStringOption(option =>
                option
                    .setName(TimeTravelBot.OPT_URL)
                    .setDescription("The URL.")
                    .setRequired(true)
            ) as SlashCommandBuilder;
        this.contextTimeTravel = new ContextMenuCommandBuilder()
            .setName("Time Travel URLs")
            .setType(ApplicationCommandType.Message) as ContextMenuCommandBuilder;
        this.commands = [this.slashTimeTravel, this.contextTimeTravel];
    }

    async processCommand(interaction: CommandInteraction): Promise<void> {
        if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) {
            return;
        }

        console.log(`[TimeTravelBot] got interaction: ${interaction}`);
        try {
            if (interaction.isChatInputCommand() && interaction.commandName === this.slashTimeTravel.name) {
                await this.handleSlashCommand(interaction);
            } else if (interaction.isMessageContextMenuCommand() && interaction.commandName === this.contextTimeTravel.name) {
                await this.handleContextCommand(interaction);
            }
        } catch (error) {
            console.error(`[TimeTravelBot] Uncaught exception in processSlashCommand(): ${error}`);
        }
    }

    async useClient(client: Client): Promise<void> {
        if (this.config.autoTimeTravel) {
            client.on("messageCreate", async (message) => {
                if (message.author.id === client.user?.id) {
                    return;
                }

                await this.handleAuto(message, false);
            });
        }
    }

    async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const url = interaction.options.getString(TimeTravelBot.OPT_URL, true);
        try {
            await interaction.deferReply();
            console.log(`[TimeTravelBot] got URL: ${url}`);

            if (!TimeTravelBot.isValidUrl(url)) {
                await interaction.editReply({
                    embeds: [TimeTravelBot.createFailedEmbed(url, "Invalid URL.")]
                });
                return;
            }

            await interaction.editReply({
                embeds: [TimeTravelBot.createHoldEmbed(url)]
            });

            const resultEmbed = await this.timeTravel(url);
            await interaction.editReply({
                embeds: [resultEmbed]
            });
        } catch (error) {
            console.error(`[TimeTravelBot] Got error handling slash command: ${error}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createFailedEmbed(url, error)]
            });
        }
    }

    async timeTravel(originalUrl: string): Promise<EmbedBuilder> {
        console.log(`[TimeTravelBot] Attempting to time travel ${originalUrl}`);

        const fullUrl = `https://timetravel.mementoweb.org/api/json/${TimeTravelBot.getCurrentTime()}/${originalUrl}`;
        console.log(`[TimeTravelBot] Calling GET ${fullUrl}`);

        try {
            const response = await axios.get(fullUrl);
            const status = response.status;
            if (status === 200) {
                const closest = response.data.mementos.closest;
                console.log(`[TimeTravelBot] Success on GET ${fullUrl}:\n${JSON.stringify(closest)}`);

                let found = null;
                for (const priorityHost of this.config.priority) {
                    for (const archiveStr of closest.uri) {
                        const archiveUrl = new URL(archiveStr);
                        if (archiveUrl.hostname === priorityHost.trim()) {
                            found = archiveStr;
                            break;
                        }
                    }
                }

                if (found === null) {
                    found = closest.uri[0];
                }

                return TimeTravelBot.createSuccessEmbed(originalUrl, found, closest.datetime);
            } else {
                console.log(`[TimeTravelBot] Nothing found on GET ${fullUrl}`);
                return TimeTravelBot.createFailedEmbed(originalUrl, "No Mementos found.");
            }
        } catch (error) {
            if (axios.isAxiosError(error) && error.response !== undefined) {
                console.error(`[TimeTravelBot] Axios error while calling GET ${fullUrl}:\n${error.response.status} ${error.response.data}`);
                return TimeTravelBot.createFailedEmbed(originalUrl, error.response.status);
            } else {
                console.error(`[TimeTravelBot] Non-Axios error while calling GET ${fullUrl}:\n${error}`);
                return TimeTravelBot.createFailedEmbed(originalUrl, error);
            }
        }
    }

    async handleContextCommand(interaction: MessageContextMenuCommandInteraction): Promise<void> {
        const content = interaction.targetMessage.content;
        console.log(`[TimeTravelBot] Got handleContextCommand() for message: ${content}`);
        const embed = new EmbedBuilder()
            .setTitle("Processing time travel for the URLs of the target message")
            .addFields({ name: "Target Message:", value: interaction.targetMessage.url })
            .setColor(0xFFFFFF);
        const reply = await interaction.reply({ embeds: [embed] });
        const urlCount = await this.handleAuto(interaction.targetMessage, true);
        if (urlCount === 0) {
            embed
                .setDescription("No valid URLs found.")
                .setColor(0xFF0000);
            await interaction.editReply({ embeds: [embed] });
        }
    }

    async handleAuto(message: Message, contextMenu: boolean): Promise<number> {
        try {
            const content = message.content;

            const linkifyResults = find(content, "url");
            if (linkifyResults.length === 0) {
                return 0;
            }

            const urls = new Set<string>();
            for (const result of linkifyResults) {
                try {
                    const url = new URL(result.href);
                    if (url.pathname === "/") {
                        continue;
                    }

                    let hostname = url.hostname;
                    if (hostname.startsWith("www.")) {
                        hostname = hostname.substring(4);
                    }

                    if (contextMenu || this.config.allowlist[hostname]) {
                        urls.add(result.href);
                    }
                } catch (error) {
                    console.error(`[TimeTravelBot] Ignoring error: ${error}`);
                    continue;
                }
            }

            if (urls.size === 0) {
                return 0;
            }

            console.log(`[TimeTravelBot] handleAuto() May have found URLs: ${JSON.stringify(Array.from(urls))}`);

            for (const url of urls) {
                const holdEmbed = await TimeTravelBot.createHoldEmbed(url);
                const replyMsg = await message.reply({
                    embeds: [holdEmbed],
                    allowedMentions: {
                        repliedUser: false
                    }
                });

                try {
                    const replyEmbed = await this.timeTravel(url);
                    await replyMsg.edit({
                        embeds: [replyEmbed],
                        allowedMentions: {
                            repliedUser: false
                        }
                    });
                } catch (error) {
                    console.error(`[TimeTravelBot] Error in auto while calling timeTravel(): ${error}`);
                    await replyMsg.edit({
                        embeds: [TimeTravelBot.createFailedEmbed(url, error)]
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 2000)); // rate limit if we move too fast
            }

            console.log("[TimeTravelBot] handleAuto() finished");
            return urls.size;
        } catch (error) {
            console.error(`[TimeTravelBot] Ran into error in handleAuto(), ignoring: ${error}`);
            return 0;
        }
    }

    async init(): Promise<string | null> {
        try {
            this.config = await readYamlConfig<TimeTravelConfig>(import.meta, "config.yaml");
        } catch (error) {
            const errMsg = `[TimeTravelBot] Unable to read config: ${error}`;
            console.error(errMsg);
            return errMsg;
        }

        return null;
    }

    static getCurrentTime(): string {
        const isoStr = new Date().toISOString(); // 2011-10-05T14:48:00.000Z
        return isoStr.split(".")[0]
            .replace(/-/g, "")
            .replace(/T/g, "")
            .replace(/:/g, "");
    }

    static createHoldEmbed(url: string): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle("Time traveling, please hold...")
            .setColor(0x8C8F91)
            .addFields({ name: "Original URL", value: url });
    }

    static createSuccessEmbed(originalUrl: string, mementoUrl: string, datetime: string): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle("Time travel successful")
            .setColor(0x00FF00)
            .addFields(
                { name: "Memento URL", value: mementoUrl },
                { name: "Original URL", value: originalUrl }
            )
            .setFooter({ text: `Timestamp of Memento: ${datetime}` });
    }

    static createFailedEmbed(url: string, error: unknown = null): EmbedBuilder {
        let reason = "Unknown error. Bot owner should check logs.";
        if (error instanceof Error) {
            reason = error.message;
        } else if (typeof error === "string") {
            reason = error;
        } else if (typeof error === "number") {
            reason = error.toString();
        }

        return new EmbedBuilder()
            .setTitle("Error while time traveling")
            .setColor(0xFF0000)
            .addFields(
                { name: "Reason", value: reason },
                { name: "Original URL", value: url }
            );
    }

    static isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}
