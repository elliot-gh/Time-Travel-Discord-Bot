import { ArchiveSubmissionResult, IArchiveSubmission } from "./IArchiveSubmission";
import axios from "axios";

export class InternetArchiveSubmission implements IArchiveSubmission {
    private static readonly JOB_REGEX = new RegExp(String.raw`Job\("([^ ",\\/:]+)",`, "i");

    readonly name: string;
    readonly originalUrl: string;
    private jobId: string | null;
    private timestamp: string | null;
    private statusCode: number | null;

    constructor(url: string) {
        console.log(`[InternetArchiveSubmission] constructor for url ${url}`);
        this.name = "Internet Archive";
        this.originalUrl = url;
        this.jobId = null;
        this.timestamp = null;
        this.statusCode = null;
    }

    async submit(): Promise<ArchiveSubmissionResult> {
        const fullUrl = `https://web.archive.org/save/${this.originalUrl}`;
        const formData = new FormData();
        formData.append("url", this.originalUrl);
        formData.append("capture_all", "on");

        console.log(`[InternetArchiveSubmission] Calling submit() using url ${fullUrl}`);
        const response = await axios.post(fullUrl, { validateStatus: () => true });
        this.statusCode = response.status;
        if (this.statusCode !== 200) {
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: false,
                finalUrl: null
            };
        }

        const responseStr = response.data as string;
        const regexMatches = responseStr.match(InternetArchiveSubmission.JOB_REGEX);
        if (regexMatches === null || regexMatches.length === 0) {
            const errStr = `[InternetArchiveSubmission] Unable to find job ID in response: ${responseStr}`;
            console.error(errStr);
            throw new Error(errStr);
        }

        this.jobId = regexMatches[1];
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: false,
            finalUrl: null
        };
    }

    async checkStatus(): Promise<ArchiveSubmissionResult> {
        if (this.timestamp !== null) {
            const mementoUrl = this.timestampToMementoUrl();
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: true,
                finalUrl: mementoUrl
            };
        }

        const fullUrl = `https://web.archive.org/save/status/${this.jobId}`;
        console.log(`[InternetArchiveSubmission] Calling checkStatus() using url ${fullUrl}`);
        const response = await axios.get(fullUrl, { validateStatus: () => true });
        this.statusCode = response.status;
        if (this.statusCode !== 200) {
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: false,
                finalUrl: null
            };
        }

        const responseObj = JSON.parse(response.data as string);
        const status = responseObj.status as string;
        if (status !== "success") {
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: false,
                finalUrl: null
            };
        }

        const timestamp = responseObj.timestamp as string;
        this.timestamp = timestamp;
        const mementoUrl = this.timestampToMementoUrl();
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: true,
            finalUrl: mementoUrl
        };
    }

    timestampToMementoUrl(): string {
        return `https://web.archive.org/web/${this.timestamp}/${this.originalUrl}`;
    }
}