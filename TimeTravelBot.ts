import { EventEmitter } from "node:events";
import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction, Client, Message, GatewayIntentBits, ChatInputCommandInteraction, EmbedBuilder,
    ContextMenuCommandBuilder, ApplicationCommandType, MessageContextMenuCommandInteraction, ButtonBuilder,
    ActionRowBuilder, ButtonStyle, User, italic, BaseMessageOptions, ButtonInteraction, TextInputBuilder, ModalSubmitInteraction, ModalBuilder } from "discord.js";
import { APIEmbedField, TextInputStyle } from "discord-api-types/v10";
import { find } from "linkifyjs";
import { TimeTravelProcessorResult, TimeTravelProcessor, TimeTravelProcessorSubmissionEvent } from "./TimeTravelProcessor";
import { BotWithConfig } from "../../BotWithConfig";

type TimeTravelConfig = {
    autoTimeTravel: boolean,
    axiosUserAgent: string | null,
    allowlist: {
        [domain: string]: boolean
    },
    mementoDepots: {
        [depotName: string]: {
            timeGate: string,
            fallback: string | null
        }
    }
}


type MementoEmbedDetails = {
    originalUrl: string,
    mementoDepotName: string,
    mementoUrl: string,
    mementoReason: string | null,
    wasSubmitted: boolean,
    userUrl: string | null,
    user: User | null,
    datetime: Date | string | null
}

export class TimeTravelBot extends BotWithConfig {
    intents: GatewayIntentBits[];
    commands: (SlashCommandBuilder | ContextMenuCommandBuilder)[];

    private static readonly OPT_URL = "url";
    private static readonly BTN_USER_URL_MODAL = "timeTravel_btnUserUrlModal";
    private static readonly BTN_USER_URL_DELETE = "timeTravel_btnUserUrlDelete";
    private static readonly MODAL_ID_USER_URL = "timeTravel_modalUrlId";
    private static readonly MODAL_INPUT_URL = "timeTravel_modalInputUrl";
    private static readonly COLOR_SUCCESS = 0x00FF00;
    private static readonly COLOR_FALLBACK = 0xFFCC00;
    private static readonly COLOR_USER_ONLY = 0X40A6CE;
    private static readonly AUTO_TIMEOUT = 500;
    private static readonly FALLBACK_REASON = "Ran into an error while time traveling. The above URL should still let you get the latest snapshot.";
    private static readonly SUBMISSION_REASON = "Did not find an existing Memento, so created a new submission.";

    private slashTimeTravel!: SlashCommandBuilder;
    private contextTimeTravel!: ContextMenuCommandBuilder;
    private readonly config: TimeTravelConfig;

    constructor() {
        super("TimeTravelBot", import.meta);
        this.config = this.readYamlConfig<TimeTravelConfig>("config.yaml");
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
            .setDMPermission(false)
            .setType(ApplicationCommandType.Message) as ContextMenuCommandBuilder;
        this.commands = [this.slashTimeTravel, this.contextTimeTravel];
    }

    async processCommand(interaction: CommandInteraction): Promise<void> {
        if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) {
            return;
        }

        this.logger.info(`got interaction: ${interaction}`);
        try {
            if (interaction.isChatInputCommand() && interaction.commandName === this.slashTimeTravel.name) {
                await this.handleSlashCommand(interaction);
            } else if (interaction.isMessageContextMenuCommand() && interaction.commandName === this.contextTimeTravel.name) {
                await this.handleContextCommand(interaction);
            }
        } catch (error) {
            this.logger.error(`Uncaught exception in processSlashCommand(): ${error}`);
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

            client.on("interactionCreate", async (interaction) => {
                if (interaction.user.id === client.user?.id) {
                    return;
                }

                if (interaction.isButton()) {
                    await this.handleButtonClick(interaction);
                } else if (interaction.isModalSubmit()) {
                    await this.handleModalSubmit(interaction);
                }
            });
        }
    }

    private async handleButtonClick(interaction: ButtonInteraction): Promise<void> {
        if (interaction.customId === TimeTravelBot.BTN_USER_URL_MODAL) {
            this.logger.info(`Got button click: ${interaction.customId}`);
            await this.handleUserUrlModalClick(interaction);
        } else if (interaction.customId === TimeTravelBot.BTN_USER_URL_DELETE) {
            this.logger.info(`Got button click: ${interaction.customId}`);
            await this.handleUserDeleteClick(interaction);
        }
    }

    private async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
        if (interaction.customId === TimeTravelBot.MODAL_ID_USER_URL) {
            this.logger.info(`Got modal submit: ${interaction.customId}`);
            await this.handleUserUrlModalSubmit(interaction);
        }
    }

    private async handleUserUrlModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
        const userUrl = interaction.fields.getTextInputValue(TimeTravelBot.MODAL_INPUT_URL);
        this.logger.info(`Got user URL: ${userUrl} from user: ${interaction.user}}`);
        const validUrl = TimeTravelBot.getValidUrl(userUrl, false);
        if (validUrl === null) {
            this.logger.info(`Invalid URL: ${userUrl} from user: ${interaction.user}}`);
            await interaction.reply({
                embeds: [TimeTravelBot.createErrorEmbed("Invalid URL", userUrl)],
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({
            ephemeral: true
        });

        if (interaction.message === null) {
            this.logger.error(`Could not get message from interaction: ${interaction}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createErrorEmbed("Something went wrong when processing your modal submission.", null)],
            });
            return;
        }

        const details = this.extractDetailsFromMessage(interaction.message);
        if (details === null)  {
            this.logger.error(`Could not extract details from message: ${interaction.message}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createErrorEmbed("Something went wrong when processing your modal submission.", null)],
            });
            return;
        }
        details.user = interaction.user;
        details.userUrl = validUrl;

        const newMsg = TimeTravelBot.createMementoEmbed(details);
        try {
            await interaction.message.edit(newMsg);
        } catch (error) {
            this.logger.error(`Could not edit message: ${error}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createErrorEmbed("Something went wrong when processing your modal submission.", null)],
            });
            return;
        }

        await interaction.editReply({
            embeds: [TimeTravelBot.createReferencedMessageSuccessEmbed(interaction.message, "Time travel message updated", "Your URL", validUrl)]
        });
    }

    private async handleUserUrlModalClick(interaction: ButtonInteraction): Promise<void> {
        const urlInput = new TextInputBuilder()
            .setCustomId(TimeTravelBot.MODAL_INPUT_URL)
            .setLabel("URL to Share")
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(8)
            .setRequired(true);
        const row = new ActionRowBuilder().addComponents(urlInput) as ActionRowBuilder<TextInputBuilder>;

        const modal = new ModalBuilder()
            .setCustomId(TimeTravelBot.MODAL_ID_USER_URL)
            .setTitle("Providing your own URL")
            .addComponents(row);

        await interaction.showModal(modal);
    }

    private async handleUserDeleteClick(interaction: ButtonInteraction): Promise<void> {
        const message = interaction.message;

        await interaction.deferReply({
            ephemeral: true
        });

        const details = this.extractDetailsFromMessage(message);
        if (details === null)  {
            this.logger.error(`Could not extract details from message: ${message}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createErrorEmbed("Something went wrong when processing your modal submission.", null)],
            });
            return;
        }
        const oldUrl = details.userUrl;
        details.user = null;
        details.userUrl = null;

        const newMsg = TimeTravelBot.createMementoEmbed(details);
        try {
            await message.edit(newMsg);
        } catch (error) {
            this.logger.error(`Could not edit message in handleUserDeleteClick(): ${error}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createErrorEmbed("Something went wrong when processing your modal submission.", null)],
            });
            return;
        }

        await interaction.editReply({
            embeds: [TimeTravelBot.createReferencedMessageSuccessEmbed(interaction.message, "Deleted user provided URL", "Old URL", oldUrl)]
        });
    }

    private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const url = interaction.options.getString(TimeTravelBot.OPT_URL, true);
        try {
            this.logger.info(`handleSlashCommand() got URL: ${url}`);

            const validUrl = TimeTravelBot.getValidUrl(url, true);
            if (validUrl === null) {
                await interaction.reply({
                    embeds: [TimeTravelBot.createErrorEmbed("Invalid URL", url)],
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply();
            await interaction.editReply(TimeTravelBot.createHoldEmbed(url));

            const eventEmitter = new EventEmitter();
            const emitterPromises: Promise<unknown>[] = [];
            const emitterId = `${interaction.id}__${Date.now()}`;
            eventEmitter.on(emitterId, (eventObj: TimeTravelProcessorSubmissionEvent) => {
                emitterPromises.push(interaction.editReply(TimeTravelBot.createHoldSaveEmbed(eventObj)));
            });
            const timeTravelPromise = this.timeTravel(url, eventEmitter, emitterId);

            try {
                await Promise.all(emitterPromises);
            } catch {
                // nothing
            }

            const result = await timeTravelPromise;
            eventEmitter.removeAllListeners(emitterId);
            await interaction.editReply(result);
        } catch (error) {
            this.logger.error(`Got error handling slash command: ${error}`);
            await interaction.editReply(TimeTravelBot.createFallbackEmbed(url, null));
        }
    }

    private async handleContextCommand(interaction: MessageContextMenuCommandInteraction): Promise<void> {
        const content = interaction.targetMessage.content;
        this.logger.info(`Got handleContextCommand() for message: ${content}`);
        const linkifyResults = find(content, "url");
        if (linkifyResults.length === 0) {
            await interaction.reply({
                embeds: [TimeTravelBot.createErrorEmbed("No URLs Found", null)],
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
        await interaction.reply({ embeds: [embed], ephemeral: true });
        try {
            await this.handleAuto(interaction.targetMessage, true);
        } catch (error) {
            this.logger.error(`Got error handling context command:\n${error}`);
            await interaction.editReply({
                embeds: [TimeTravelBot.createErrorEmbed("Unable to complete context menu command", null)]
            });
        }
    }

    private async handleAuto(message: Message, contextMenu: boolean): Promise<void> {
        try {
            const content = message.content;

            const linkifyResults = find(content, "url");
            if (linkifyResults.length === 0) {
                return;
            }

            const urls: string[] = [];
            for (const result of linkifyResults) {
                try {
                    const url = new URL(result.href);
                    let hostname = url.hostname;
                    if (hostname.startsWith("www.")) {
                        hostname = hostname.substring(4);
                    }

                    if (contextMenu) {
                        urls.push(result.href);
                        continue;
                    }

                    if (!this.config.allowlist[hostname] || url.pathname === "/") {
                        continue;
                    }

                    urls.push(result.href);
                } catch (error) {
                    this.logger.error(`Ignoring error for URL ${result.href}:\n${error}`);
                    continue;
                }
            }

            if (urls.length === 0) {
                return;
            }

            this.logger.info(`handleAuto() May have found URLs: ${JSON.stringify(Array.from(urls))}`);
            const emitterPrefix = `${message.id}__${Date.now()}__`;
            for (const url of urls) {
                const replyMsg = await message.reply(TimeTravelBot.createHoldEmbed(url));

                const eventEmitter = new EventEmitter();
                const emitterPromises: Promise<unknown>[] = [];
                const emitterId = `${emitterPrefix}${replyMsg.id}`;
                eventEmitter.on(emitterId, (eventObj: TimeTravelProcessorSubmissionEvent) => {
                    emitterPromises.push(replyMsg.edit(TimeTravelBot.createHoldSaveEmbed(eventObj)));
                });
                const timeTravelPromise = this.timeTravel(url, eventEmitter, emitterId);

                try {
                    await Promise.all(emitterPromises);
                } catch {
                    // nothing
                }

                try {
                    const result = await timeTravelPromise;
                    await replyMsg.edit(result);
                } catch (error) {
                    this.logger.error(`Error in auto while calling timeTravel() for url ${url}:\n${error}`);
                    await replyMsg.edit(TimeTravelBot.createFallbackEmbed(url, null));
                }

                eventEmitter.removeAllListeners(emitterId);
                await new Promise(resolve => setTimeout(resolve, TimeTravelBot.AUTO_TIMEOUT));
            }

            this.logger.info("handleAuto() finished");
        } catch (error) {
            this.logger.error(`Ran into error in handleAuto(), ignoring: ${error}`);
        }
    }

    private async timeTravel(originalUrl: string, eventEmitter: EventEmitter, emitterId: string): Promise<BaseMessageOptions> {
        this.logger.info(`Attempting to time travel ${originalUrl}`);
        const processor = new TimeTravelProcessor(originalUrl);

        let result: TimeTravelProcessorResult | null = null;
        try {
            result = await processor.process(eventEmitter, emitterId);
        } catch (error) {
            this.logger.error(`Error in timeTravel():\n${error}`);
            result = null;
        }

        if (result === null) {
            this.logger.error(`Got null result for ${originalUrl}`);
            return TimeTravelBot.createFallbackEmbed(originalUrl, processor.getFallbackUrl());
        }

        this.logger.info(`timeTravel() processor for ${originalUrl} returned result:\n${JSON.stringify(result, null, 2)}`);
        if (result.foundUrl !== null && result.depotUsedName !== null) {
            return TimeTravelBot.createMementoEmbed({
                originalUrl: originalUrl,
                mementoUrl: result.foundUrl,
                mementoDepotName: result.depotUsedName,
                mementoReason: null,
                wasSubmitted: false,
                userUrl: null,
                user: null,
                datetime: result.datetime,
            });
        } else if (result.submittedUrl !== null && result.submittedName !== null) {
            return TimeTravelBot.createMementoEmbed({
                originalUrl: originalUrl,
                mementoUrl: result.submittedUrl,
                mementoDepotName: result.submittedName,
                mementoReason: TimeTravelBot.SUBMISSION_REASON,
                wasSubmitted: true,
                userUrl: null,
                user: null,
                datetime: result.datetime,
            });
        }

        this.logger.error(`timeTravel() processor for ${originalUrl} returned malformed result:\n${JSON.stringify(result, null, 2)}`);
        return TimeTravelBot.createFallbackEmbed(originalUrl, processor.getFallbackUrl());
    }

    async preInit(): Promise<string | null> {
        try {
            TimeTravelProcessor.init(this.config);
        } catch (error) {
            const errMsg = `Unable to read config: ${error}`;
            this.logger.error(errMsg);
            return errMsg;
        }

        return null;
    }

    private extractDetailsFromMessage(message: Message): MementoEmbedDetails | null {
        const referencedEmbeds = message.embeds;
        if (referencedEmbeds === undefined || referencedEmbeds.length === 0) {
            this.logger.error(`Could not find referenced message or embeds: ${message}`);
            return null;
        }

        const referencedEmbed = referencedEmbeds[0];
        const referencedFields = referencedEmbed.fields;
        if (referencedFields.length < 2) {
            this.logger.error(`Could not find referenced message fields: ${message}`);
            return null;
        }

        const mementoField = referencedFields[0];
        let userField: APIEmbedField | null = null;
        let originalField = referencedFields[1];
        if (referencedFields.length === 3) {
            userField = referencedFields[1];
            originalField = referencedFields[2];
        }

        const originalUrl = originalField.value;

        let userUrl: string | null = null;
        if (userField !== null) {
            const userNewLineIndex = userField.value.indexOf("\n");
            if (userNewLineIndex > -1) {
                userUrl = userField.value.substring(0, userNewLineIndex);
            }
        }

        const mementoDepotName = mementoField.name.substring(0, mementoField.name.indexOf(" URL"));
        const mementoNewLineIndex = mementoField.value.indexOf("\n");
        let mementoUrl = mementoField.value;
        let mementoReason: string | null = null;
        if (mementoNewLineIndex > -1) {
            mementoUrl = mementoField.value.substring(0, mementoNewLineIndex);
            mementoReason = mementoField.value.substring(mementoNewLineIndex + 1);
            if ((mementoReason.charAt(0) === "*" && mementoReason.charAt(mementoReason.length - 1) === "*") ||
                    (mementoReason.charAt(0) === "_" && mementoReason.charAt(mementoReason.length - 1) === "_")) {
                mementoReason = mementoReason.substring(1, mementoReason.length - 1);
            }
        }
        const wasSubmitted = mementoReason !== null && mementoReason === TimeTravelBot.SUBMISSION_REASON;
        const datetime = referencedEmbed.footer?.text === undefined ? null : referencedEmbed.footer?.text;

        return {
            originalUrl: originalUrl,
            mementoDepotName: mementoDepotName,
            mementoUrl: mementoUrl,
            mementoReason: mementoReason,
            wasSubmitted: wasSubmitted,
            datetime: datetime,
            user: null,
            userUrl: userUrl
        };
    }

    private static dateToTimeStr(date: Date | null): string {
        if (date !== null) {
            return date.toLocaleString("en-US");
        } else {
            return "Time unknown";
        }
    }

    private static createHoldEmbed(url: string): BaseMessageOptions {
        return {
            embeds: [new EmbedBuilder()
                .setTitle("Time traveling, please hold...")
                .setColor(0x8C8F91)
                .addFields({ name: "Original URL", value: url })],
            allowedMentions: {
                repliedUser: false
            }
        };
    }

    private static createHoldSaveEmbed(submissionEvent: TimeTravelProcessorSubmissionEvent): BaseMessageOptions {
        return {
            embeds: [new EmbedBuilder()
                .setTitle("Attempting to save a new link, please hold...")
                .setColor(0x8C8F91)
                .addFields(
                    { name: submissionEvent.submittedName, value: "Submitting request to save a new link..." },
                    { name: "Original URL", value: submissionEvent.originalUrl }
                )],
            allowedMentions: {
                repliedUser: false
            }
        };
    }

    private static createFallbackEmbed(originalUrl: string, fallbackUrl: string | null): BaseMessageOptions {
        return TimeTravelBot.createMementoEmbed({
            originalUrl: originalUrl,
            mementoDepotName: "Fallback",
            mementoUrl: fallbackUrl !== null ? fallbackUrl : TimeTravelProcessor.getFallbackUrl(originalUrl),
            mementoReason: TimeTravelBot.FALLBACK_REASON,
            wasSubmitted: false,
            datetime: null,
            user: null,
            userUrl: null
        });
    }

    private static createMementoEmbed(details: MementoEmbedDetails): BaseMessageOptions {
        let embedColor = TimeTravelBot.COLOR_SUCCESS;
        const fields: APIEmbedField[] = [];

        let mementoFieldValue = details.mementoUrl;
        if (details.mementoReason !== null) {
            mementoFieldValue += `\n${italic(details.mementoReason)}`;
            if (!details.wasSubmitted) {
                embedColor = TimeTravelBot.COLOR_FALLBACK;
            }
        }
        fields.push({ name: `${details.mementoDepotName} URL`, value: mementoFieldValue });

        let userUrlDeleteBtn: ButtonBuilder | null = null;
        if (details.userUrl !== null && details.user !== null) {
            fields.push({
                name: "User Provided URL",
                value: `${details.userUrl}\n${italic("Submitted by " + details.user.toString())}`
            });
            userUrlDeleteBtn = TimeTravelBot.createUserUrlDeleteButton();

            if (embedColor === TimeTravelBot.COLOR_FALLBACK) {
                embedColor = TimeTravelBot.COLOR_USER_ONLY;
            }
        }

        fields.push({ name: "Original URL", value: details.originalUrl });
        let timestampText = "";
        if (typeof details.datetime === "string") {
            timestampText = details.datetime;
        } else {
            timestampText = TimeTravelBot.dateToTimeStr(details.datetime);
        }

        const embed = new EmbedBuilder()
            .setTitle("Time travel complete")
            .setColor(embedColor)
            .addFields(fields)
            .setFooter({ text: timestampText });

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

    private static createErrorEmbed(title: string, url: string | null): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(0xFF0000);
        if (url !== null) {
            embed.addFields({ name: "Provided URL", value: url });
        }

        return embed;
    }

    private static createReferencedMessageSuccessEmbed(referencedMessage: Message, title: string, urlName: string | null, urlValue: string | null): EmbedBuilder {
        const fields: APIEmbedField[] = [
            { name: "Message", value: referencedMessage.url }
        ];

        if (urlName !== null && urlValue !== null) {
            fields.push({ name: urlName, value: urlValue });
        }

        return new EmbedBuilder()
            .setTitle(title)
            .addFields(fields)
            .setColor(0x00FF00);
    }

    private static createUserUrlSubmitButton(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(TimeTravelBot.BTN_USER_URL_MODAL)
            .setLabel("Provide user URL")
            .setStyle(ButtonStyle.Secondary);
    }

    private static createUserUrlDeleteButton(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(TimeTravelBot.BTN_USER_URL_DELETE)
            .setLabel("Delete user URL")
            .setStyle(ButtonStyle.Danger);
    }

    private static getValidUrl(url: string, addHttps: boolean): string | null {
        try {
            let returnUrl = url.trim();
            if (addHttps && (!returnUrl.startsWith("http://") || !returnUrl.startsWith("https://"))) {
                returnUrl = `https://${returnUrl}`;
            }

            new URL(returnUrl);
            return returnUrl;
        } catch {
            return null;
        }
    }

    getIntents(): GatewayIntentBits[] {
        return this.intents;
    }

    getSlashCommands(): (SlashCommandBuilder | ContextMenuCommandBuilder)[] {
        return this.commands;
    }
}
