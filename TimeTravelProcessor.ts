import { EventEmitter } from "node:events";
import { TimeTravelConfig } from "./TimeTravelConfig";
import { Memento, MementoDepot } from "./archivers/MementoDepot";
import { ArchiveTodaySubmission } from "./archivers/ArchiveTodaySubmission";
import { InternetArchiveSubmission } from "./archivers/InternetArchiveSubmission";
import { IArchiveSubmission } from "./archivers/IArchiveSubmission";

export class TimeTravelProcessorError extends Error {
    private statusCode = -1;
    constructor(message: string) {
        super(message);
        this.name = "TimeTravelProcessorError";
    }

    getStatusCode(): number {
        return this.statusCode;
    }

    setStatusCode(statusCode: number): void {
        this.statusCode = statusCode;
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

export type TimeTravelProcessorSubmissionEvent = {
    originalUrl: string,
    submittedName: string
};

export class TimeTravelProcessor {
    private static readonly DEFAULT_FALLBACK_URL_PREFIX = "https://archive.today/newest/";
    private static readonly SUBMISSION_TIMEOUT = 3000;

    private static userAgent: string | null;
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

    async process(eventEmitter: EventEmitter, emitterId: string): Promise<TimeTravelProcessorResult> {
        console.log(`[TimeTravelProcessor] beginProcessing() for url ${this.formattedUrl}`);

        // try search through depots
        let shouldSubmit = false;
        for (const depotName in TimeTravelProcessor.depots) {
            try {
                return await this.useSpecificDepot(depotName);
            } catch (error) {
                console.error(`[TimeTravelProcessor] beginProcessing() error while using depot ${depotName}:\n${error}`);
                if (error instanceof TimeTravelProcessorError) {
                    if (error.getStatusCode() >= 300 && error.getStatusCode() < 500) {
                        shouldSubmit = true;
                    }
                }
            }
        }

        if (!shouldSubmit) {
            const errStr = `[TimeTravelProcessor] Unable to find any mementos for url ${this.formattedUrl} and did not get a 404`;
            console.error(errStr);
            throw new TimeTravelProcessorError(errStr);
        }

        // attempt to submit to archive.today
        try {
            const submitters: IArchiveSubmission[] = [
                new ArchiveTodaySubmission(this.formattedUrl, TimeTravelProcessor.userAgent),
                new InternetArchiveSubmission(this.formattedUrl, TimeTravelProcessor.userAgent)
            ];

            for (const submitter of submitters) {
                try {
                    console.log(`[TimeTravelProcessor] beginProcessing() submitting to ${submitter.name} for url ${this.formattedUrl}`);
                    const emitterEvent: TimeTravelProcessorSubmissionEvent = {
                        originalUrl: this.formattedUrl,
                        submittedName: submitter.name
                    };
                    eventEmitter.emit(emitterId, emitterEvent);

                    let result = await submitter.submit();
                    let isDone = result.isDone;
                    while (!isDone) {
                        if (submitter.waitBetweenStatus !== null) {
                            await new Promise(resolve => setTimeout(resolve, submitter.waitBetweenStatus!));
                        }

                        console.log(`[TimeTravelProcessor] beginProcessing() checking status of ${submitter.name} for url ${this.formattedUrl}`);
                        result = await submitter.checkStatus();
                        isDone = result.isDone;
                    }

                    if (result.finalUrl === null) {
                        console.error(`[TimeTravelProcessor] Unable to submit to ${submitter.name} for url ${this.formattedUrl}, got status code ${result.statusCode}`);
                        continue;
                    }

                    return {
                        originalUrl: this.formattedUrl,
                        depotUsedName: null,
                        foundUrl: null,
                        submittedUrl: result.finalUrl,
                        submittedName: submitter.name,
                        datetime: result.datetime
                    };
                } catch (error) {
                    console.error(`[TimeTravelProcessor] Error while trying to submit to ${submitter.name} for url ${this.formattedUrl}:\n${error}`);
                    continue;
                }
            }

            const errStr = `[TimeTravelProcessor] Unable to submit to any archive for url ${this.formattedUrl}`;
            console.error(errStr);
            throw new TimeTravelProcessorError(errStr);
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
    async useSpecificDepot(depotName: string): Promise<TimeTravelProcessorResult> {
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
            const errStr = `${result.status}: [TimeTravelProcessor] Got status code ${result.status} from ${depotName} for url ${this.formattedUrl}`;
            console.error(errStr);
            const statusError = new TimeTravelProcessorError(errStr);
            statusError.setStatusCode(result.status);
            throw statusError;
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
        TimeTravelProcessor.userAgent = config.axiosUserAgent;
        for (const depotName in config.mementoDepots) {
            const depotConfig = config.mementoDepots[depotName];
            const depot = new MementoDepot(depotConfig.timeGate, depotConfig.fallback, config.axiosUserAgent);
            TimeTravelProcessor.depots[depotName] = depot;
            if (depotConfig.fallback !== null && TimeTravelProcessor.fallbackDepot !== null) {
                TimeTravelProcessor.fallbackDepot = depot;
            }
        }
    }
}