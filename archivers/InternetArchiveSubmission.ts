import { ArchiveSubmissionResult, IArchiveSubmission } from "./IArchiveSubmission";
import axios, { AxiosRequestConfig } from "axios";
import { MementoDepot } from "./MementoDepot";

export class InternetArchiveSubmission implements IArchiveSubmission {
    readonly name: string;
    readonly originalUrl: string;
    readonly userAgent: string | null;
    readonly waitBetweenStatus = null;
    private jobId: string | null;
    private datetime: Date | null = null;
    private statusCode: number | null;
    private isDone = false;
    private finalUrl: string | null = null;

    constructor(url: string, userAgent: string | null) {
        console.log(`[InternetArchiveSubmission] constructor for url ${url}`);
        this.name = "Internet Archive";
        this.originalUrl = url;
        this.jobId = null;
        this.statusCode = null;
        this.userAgent = userAgent;
    }

    async submit(): Promise<ArchiveSubmissionResult> {
        const fullUrl = `https://web.archive.org/save/${this.originalUrl}`;

        console.log(`[InternetArchiveSubmission] Calling submit() using url ${fullUrl}`);
        const axiosConfig: AxiosRequestConfig = {
            validateStatus: () => true
        };

        if (this.userAgent !== null) {
            axiosConfig.headers = {
                "User-Agent": this.userAgent
            };
        }

        const response = await axios.get(fullUrl, axiosConfig);
        this.isDone = true;
        this.statusCode = response.status;
        if (this.statusCode >= 400) {
            this.isDone = true;
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: this.isDone,
                finalUrl: null,
                datetime: null
            };
        }

        const mementoUrl: string | null = MementoDepot.parseResponseHeaders(response.headers);
        if (mementoUrl === null) {
            console.error(`[InternetArchiveSubmission] Could not find URL in response headers:\n${JSON.stringify(response.headers, null, 2)}`);
            this.isDone = true;
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: this.isDone,
                finalUrl: null,
                datetime: null
            };
        }

        this.finalUrl = mementoUrl;
        this.datetime = MementoDepot.getDateFromMementoUrl(mementoUrl);
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: this.isDone,
            finalUrl: this.finalUrl,
            datetime: this.datetime
        };
    }

    async checkStatus(): Promise<ArchiveSubmissionResult> {
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: this.isDone,
            finalUrl: this.finalUrl,
            datetime: this.datetime
        };
    }
}