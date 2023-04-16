import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction, Client, Message, GatewayIntentBits, ChatInputCommandInteraction, EmbedBuilder,
    ContextMenuCommandBuilder, ApplicationCommandType, MessageContextMenuCommandInteraction, ButtonBuilder,
    ActionRowBuilder, ButtonStyle, User, italic, BaseMessageOptions } from "discord.js";
import { APIEmbedField } from "discord-api-types/v10";
import { find } from "linkifyjs";
import { BotInterface } from "../../BotInterface";
import { readYamlConfig } from "../../utils/ConfigUtils";
import { TimeTravelConfig } from "./TimeTravelConfig";
import { TimeTravelProcessorResult, TimeTravelProcessor } from "./TimeTravelProcessor";

export class TimeTravelBot implements BotInterface {
    intents: GatewayIntentBits[];
    commands: (SlashCommandBuilder | ContextMenuCommandBuilder)[];

    private static readonly OPT_URL = "url";
    private static readonly BTN_USER_URL_MODAL = "timeTravel_btnUserUrlModal";
    private static readonly BTN_USER_URL_DELETE = "timeTravel_btnUserUrlDelete";
    private static readonly COLOR_SUCCESS = 0x00FF00;
    private static readonly COLOR_FALLBACK = 0xFFCC00;
    private static readonly COLOR_USER_ONLY = 0X40A6CE;
    private static readonly AUTO_TIMEOUT = 2000;

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
            console.log(`[TimeTravelBot] handleSlashCommand() got URL: ${url}`);

            const validUrl = TimeTravelBot.getValidUrl(url);
            if (validUrl === null) {
                await interaction.reply({
                    embeds: [TimeTravelBot.createInvalidEmbed("Invalid URL", url)],
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply();
            const holdPromise = interaction.editReply(TimeTravelBot.createHoldEmbed(url));

            const result = await this.timeTravel(url);
            await holdPromise;
            await interaction.editReply(result);
        } catch (error) {
            console.error(`[TimeTravelBot] Got error handling slash command: ${error}`);
            await interaction.editReply(TimeTravelBot.createFallbackEmbed(url, null));
        }
    }

    async handleContextCommand(interaction: MessageContextMenuCommandInteraction): Promise<void> {
        const content = interaction.targetMessage.content;
        console.log(`[TimeTravelBot] Got handleContextCommand() for message: ${content}`);
        const linkifyResults = find(content, "url");
        if (linkifyResults.length === 0) {
            await interaction.reply({
                embeds: [TimeTravelBot.createInvalidEmbed("No URLs Found", null)],
                ephemeral: true
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle("Processing time travel for the URLs of the target message")
            .addFields(
                { name: "Target Message", value: interaction.targetMessage.url },
                { name: "URL Count", value: linkifyResults.length.toString() }
            )
            .setColor(0xFFFFFF);
        await interaction.reply({ embeds: [embed] });
        try {
            await this.handleAuto(interaction.targetMessage, true);
        } catch (error) {
            console.error(`[TimeTravelBot] Got error handling context command:\n${error}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createInvalidEmbed("Unable to complete context menu command", null)]
            });
        }
    }

    async handleAuto(message: Message, contextMenu: boolean): Promise<void> {
        try {
            const content = message.content;

            const linkifyResults = find(content, "url");
            if (linkifyResults.length === 0) {
                return;
            }

            const urls = new Set<string>();
            for (const result of linkifyResults) {
                try {
                    const url = new URL(result.href);
                    let hostname = url.hostname;
                    if (hostname.startsWith("www.")) {
                        hostname = hostname.substring(4);
                    }

                    if (contextMenu) {
                        urls.add(result.href);
                        continue;
                    }

                    if (!this.config.allowlist[hostname] || url.pathname === "/") {
                        continue;
                    }

                    urls.add(result.href);
                } catch (error) {
                    console.error(`[TimeTravelBot] Ignoring error for URL ${result.href}:\n${error}`);
                    continue;
                }
            }

            if (urls.size === 0) {
                return;
            }

            console.log(`[TimeTravelBot] handleAuto() May have found URLs: ${JSON.stringify(Array.from(urls))}`);
            for (const url of urls) {
                const holdEmbed = TimeTravelBot.createHoldEmbed(url);
                const replyMsg = await message.reply(holdEmbed);

                try {
                    const replyResult = await this.timeTravel(url);
                    await replyMsg.edit(replyResult);
                } catch (error) {
                    console.error(`[TimeTravelBot] Error in auto while calling timeTravel() for url ${url}:\n${error}`);
                    await replyMsg.edit(TimeTravelBot.createFallbackEmbed(url, null));
                }
                await new Promise(resolve => setTimeout(resolve, TimeTravelBot.AUTO_TIMEOUT)); // rate limit if we move too fast
            }

            console.log("[TimeTravelBot] handleAuto() finished");
        } catch (error) {
            console.error(`[TimeTravelBot] Ran into error in handleAuto(), ignoring: ${error}`);
        }
    }

    async timeTravel(originalUrl: string): Promise<BaseMessageOptions> {
        console.log(`[TimeTravelBot] Attempting to time travel ${originalUrl}`);
        const processor = new TimeTravelProcessor(originalUrl);

        let result: TimeTravelProcessorResult | null = null;
        try {
            result = await processor.beginProcessing();
        } catch (error) {
            console.error(`[TimeTravelBot] Error in timeTravel():\n${error}`);
            result = null;
        }

        if (result === null) {
            console.error(`[TimeTravelBot] Got null result for ${originalUrl}`);
            return TimeTravelBot.createFallbackEmbed(originalUrl, processor.getFallbackUrl());
        }

        console.log(`[TimeTravelBot] timeTravel() processor for ${originalUrl} returned result:\n${JSON.stringify(result, null, 2)}`);
        if (result.foundUrl !== null && result.depotUsedName !== null) {
            return TimeTravelBot.createMementoEmbed(originalUrl,
                result.depotUsedName, result.foundUrl, null, false,
                null, null, result.datetime);
        } else if (result.submittedUrl !== null && result.submittedName !== null) {
            return TimeTravelBot.createMementoEmbed(originalUrl,
                result.submittedName, result.submittedUrl, "Did not find a Memento, so just submitted a new request to save.", true,
                null, null, result.datetime);
        }

        console.error(`[TimeTravelBot] timeTravel() processor for ${originalUrl} returned malformed result:\n${JSON.stringify(result, null, 2)}`);
        return TimeTravelBot.createFallbackEmbed(originalUrl, processor.getFallbackUrl());
    }

    async init(): Promise<string | null> {
        try {
            this.config = await readYamlConfig<TimeTravelConfig>(import.meta, "config.yaml");
            TimeTravelProcessor.init(this.config);
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

    static dateToTimeStr(date: Date | null): string {
        if (date !== null) {
            return date.toLocaleString("en-US");
        } else {
            return "Time unknown";
        }
    }

    static createHoldEmbed(url: string): BaseMessageOptions {
        return {
            embeds: [new EmbedBuilder()
                .setTitle("Time traveling, please hold...")
                .setColor(0x8C8F91)
                .addFields({ name: "Original URL", value: url })]
        };
    }

    static createFallbackEmbed(originalUrl: string, fallbackUrl: string | null): BaseMessageOptions {
        return TimeTravelBot.createMementoEmbed(originalUrl,
            "Fallback URL", fallbackUrl !== null ? fallbackUrl : TimeTravelProcessor.getFallbackUrl(originalUrl),
            "Ran into an error while time traveling. The above URL should still let you get the latest snapshot.",
            false, null, null, null);
    }

    static createMementoEmbed(originalUrl: string,
        mementoDepotName: string, mementoUrl: string, mementoReason: string | null, wasSubmitted: boolean,
        userUrl: string | null, user: User | null,
        datetime: Date | null): BaseMessageOptions {

        let embedColor = TimeTravelBot.COLOR_SUCCESS;
        const fields: APIEmbedField[] = [];

        let mementoFieldValue = mementoUrl;
        if (mementoReason !== null) {
            mementoFieldValue += `\n${italic(mementoReason)}`;
            if (!wasSubmitted) {
                embedColor = TimeTravelBot.COLOR_FALLBACK;
            }
        }
        fields.push({ name: `${mementoDepotName} URL`, value: mementoFieldValue });

        let userUrlDeleteBtn: ButtonBuilder | null = null;
        if (userUrl !== null && user !== null) {
            fields.push({
                name: "User Provided URL",
                value: `${userUrl}\n${italic("Submitted by " + user.toString())}`
            });
            userUrlDeleteBtn = TimeTravelBot.createUserUrlDeleteButton();

            if (embedColor === TimeTravelBot.COLOR_FALLBACK) {
                embedColor = TimeTravelBot.COLOR_USER_ONLY;
            }
        }

        fields.push({ name: "Original URL", value: originalUrl });

        const embed = new EmbedBuilder()
            .setTitle("Time travel complete")
            .setColor(embedColor)
            .addFields(fields)
            .setFooter({ text: `Timestamp: ${TimeTravelBot.dateToTimeStr(datetime)}` });

        const actionRow = new ActionRowBuilder() as ActionRowBuilder<ButtonBuilder>;
        actionRow.addComponents(TimeTravelBot.createUserUrlSubmitButton());
        if (userUrlDeleteBtn !== null) {
            actionRow.addComponents(userUrlDeleteBtn);
        }

        return {
            embeds: [embed],
            components: [actionRow],
            allowedMentions: {
                repliedUser: false
            }
        };
    }

    static createInvalidEmbed(title: string, url: string | null): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(0xFF0000);
        if (url !== null) {
            embed.addFields({ name: "Provided URL", value: url });
        }

        return embed;
    }

    static createUserUrlSubmitButton(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(TimeTravelBot.BTN_USER_URL_MODAL)
            .setLabel("Provide user URL")
            .setStyle(ButtonStyle.Secondary);
    }

    static createUserUrlDeleteButton(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(TimeTravelBot.BTN_USER_URL_DELETE)
            .setLabel("Delete user provided URL")
            .setStyle(ButtonStyle.Danger);
    }

    static getValidUrl(url: string): string | null {
        try {
            let returnUrl = url.trim();
            if (!returnUrl.startsWith("http://") || !returnUrl.startsWith("https://")) {
                returnUrl = `https://${returnUrl}`;
            }

            new URL(returnUrl);
            return returnUrl;
        } catch {
            return null;
        }
    }
}
