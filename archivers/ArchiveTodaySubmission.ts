import { ArchiveSubmissionResult, IArchiveSubmission } from "./IArchiveSubmission";
import axios from "axios";

export class ArchiveTodaySubmission implements IArchiveSubmission {
    readonly name: string;
    readonly originalUrl: string;
    private wipUrl: string | null;
    private statusCode: number | null;

    constructor(url: string) {
        console.log(`[ArchiveTodaySubmission] constructor for url ${url}`);
        this.name = "archive.today";
        this.originalUrl = url;
        this.wipUrl = null;
        this.statusCode = null;
    }

    async submit(): Promise<ArchiveSubmissionResult> {
        const fullUrl = `https://archive.today/submit/?url=${this.originalUrl}`;
        console.log(`[ArchiveTodaySubmission] Calling submit() using url ${fullUrl}`);
        const response = await axios.get(fullUrl, { validateStatus: () => true });
        this.statusCode = response.status;
        if (this.statusCode >= 400) {
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: false,
                finalUrl: null
            };
        }

        const refreshHeader = response.headers["refresh"] as string;
        this.wipUrl = refreshHeader.substring(refreshHeader.indexOf("url=") + 4);
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: true,
            finalUrl: this.wipUrl
        };
    }

    async checkStatus(): Promise<ArchiveSubmissionResult> {
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: this.wipUrl !== null,
            finalUrl: this.wipUrl
        };
    }
}