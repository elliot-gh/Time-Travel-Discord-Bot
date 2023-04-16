import { TimeTravelConfig } from "./TimeTravelConfig";
import { Memento, MementoDepot } from "./archivers/MementoDepot";
import { ArchiveTodaySubmission } from "./archivers/ArchiveTodaySubmission";

export class TimeTravelProcessorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TimeTravelProcessorError";
    }
}

export type TimeTravelProcessorResult = {
    originalUrl: string,
    foundUrl: string | null,
    depotUsedName: string | null,
    submittedUrl: string | null,
    submittedName: string | null,
    datetime: Date | null
}

export class TimeTravelProcessor {
    private static readonly DEFAULT_FALLBACK_URL_PREFIX = "https://archive.today/newest/";

    private static fallbackDepot: MementoDepot | null;
    private static depots: {
        [depotName: string]: MementoDepot
    } = {};

    private readonly originalUrlStr: string;
    private readonly formattedUrl: string;

    constructor(originalUrlStr: string) {
        this.originalUrlStr = originalUrlStr;
        const formattedUrlObj = new URL(originalUrlStr);
        formattedUrlObj.search = "";
        formattedUrlObj.hash = "";
        this.formattedUrl = formattedUrlObj.toString();
        console.log(`[TimeTravelProcessor] constructor for url ${originalUrlStr}, formattedUrl is ${this.formattedUrl}`);
    }

    async beginProcessing(): Promise<TimeTravelProcessorResult> {
        console.log(`[TimeTravelProcessor] beginProcessing() for url ${this.formattedUrl}`);

        // try search through depots
        let got404 = false;
        for (const depotName in TimeTravelProcessor.depots) {
            try {
                return await this.useSpecificDepotByName(depotName);
            } catch (error) {
                if (error instanceof TimeTravelProcessorError) {
                    if (error.message.includes("404")) {
                        got404 = true;
                    }
                }
            }
        }

        if (!got404) {
            const errStr = `[TimeTravelProcessor] Unable to find any mementos for url ${this.formattedUrl}`;
            console.error(errStr);
            throw new TimeTravelProcessorError(errStr);
        }

        // attempt to submit to archive.today
        try {
            const submission = new ArchiveTodaySubmission(this.formattedUrl);
            const result = await submission.submit();
            const currentDate = new Date();
            if (!result.isDone) {
                const errStr = `[TimeTravelProcessor] Unable to submit to archive.today for url ${this.formattedUrl}, got status code ${result.statusCode}`;
                console.error(errStr);
                throw new TimeTravelProcessorError(errStr);
            }

            return {
                originalUrl: this.formattedUrl,
                foundUrl: null,
                depotUsedName: null,
                submittedUrl: result.finalUrl,
                submittedName: submission.name,
                datetime: currentDate
            };
        } catch (error) {
            if (error instanceof TimeTravelProcessorError) {
                throw error;
            }

            const errStr = `[TimeTravelProcessor] Error while trying to submit to archive.today for url ${this.formattedUrl}:\n${error}`;
            console.error(errStr);
            throw new TimeTravelProcessorError(errStr);
        }
    }

    /**
     * @throws {TimeTravelProcessorError}
     */
    async useSpecificDepotByName(depotName: string): Promise<TimeTravelProcessorResult> {
        const depot = TimeTravelProcessor.depots[depotName];
        if (depot === undefined) {
            const errStr = `[TimeTravelProcessor] Could not find depot ${depotName} for url ${this.formattedUrl}`;
            console.error(errStr);
            throw new TimeTravelProcessorError(errStr);
        }

        console.log(`[TimeTravelProcessor] useSpecificDepot() ${depotName} for url ${this.formattedUrl}`);
        let result: Memento;
        try {
            result = await depot.getLatestMemento(this.formattedUrl);
        } catch (error) {
            const errStr = `[TimeTravelProcessor] Error calling getLatestMemento() on ${depotName} for url ${this.formattedUrl}:\n${error}`;
            console.error(errStr);
            throw new TimeTravelProcessorError(errStr);
        }

        if (result.status >= 400 || result.url === null) {
            const errStr = `[TimeTravelProcessor] Got status code ${result.status} from ${depotName} for url ${this.formattedUrl}`;
            console.error(errStr);
            throw new TimeTravelProcessorError(errStr);
        }

        return {
            originalUrl: this.originalUrlStr,
            depotUsedName: depotName,
            foundUrl: result.url,
            submittedUrl: null,
            submittedName: null,
            datetime: result.datetime
        };
    }

    getFallbackUrl(): string {
        return TimeTravelProcessor.getFallbackUrl(this.formattedUrl);
    }

    static getFallbackUrl(url: string): string {
        if (TimeTravelProcessor.fallbackDepot !== null) {
            const fallbackUrl = TimeTravelProcessor.fallbackDepot.getFallbackUrl(url);
            if (fallbackUrl !== null) {
                return fallbackUrl;
            }
        }

        return `${TimeTravelProcessor.DEFAULT_FALLBACK_URL_PREFIX}${url}`;
    }

    static init(config: TimeTravelConfig): void {
        for (const depotName in config.mementoDepots) {
            const depotConfig = config.mementoDepots[depotName];
            const depot = new MementoDepot(depotConfig.timeGate, depotConfig.fallback);
            TimeTravelProcessor.depots[depotName] = depot;
            if (depotConfig.fallback !== null && TimeTravelProcessor.fallbackDepot !== null) {
                TimeTravelProcessor.fallbackDepot = depot;
            }
        }
    }
}