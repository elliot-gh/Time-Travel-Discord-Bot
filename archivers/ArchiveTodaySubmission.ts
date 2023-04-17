import { ArchiveSubmissionResult, IArchiveSubmission } from "./IArchiveSubmission";
import axios, { AxiosRequestConfig } from "axios";

export class ArchiveTodaySubmission implements IArchiveSubmission {
    readonly name: string;
    readonly originalUrl: string;
    readonly userAgent: string | null;
    readonly waitBetweenStatus = null;
    private wipUrl: string | null;
    private statusCode: number | null;
    private isDone = false;
    private dateTime: Date | null = null;

    constructor(url: string, userAgent: string | null) {
        console.log(`[ArchiveTodaySubmission] constructor for url ${url}`);
        this.name = "archive.today";
        this.originalUrl = url;
        this.wipUrl = null;
        this.statusCode = null;
        this.userAgent = userAgent;
    }

    async submit(): Promise<ArchiveSubmissionResult> {
        const fullUrl = `https://archive.today/submit/?url=${this.originalUrl}`;
        console.log(`[ArchiveTodaySubmission] Calling submit() using url ${fullUrl}`);
        const axiosConfig: AxiosRequestConfig = {
            validateStatus: () => true
        };

        if (this.userAgent !== null) {
            axiosConfig.headers = {
                "User-Agent": this.userAgent
            };
        }

        const response = await axios.get(fullUrl, axiosConfig);
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

        const refreshHeader = response.headers["refresh"];
        if (refreshHeader === undefined) {
            console.error(`[ArchiveTodaySubmission] could not find refresh header in response:\n${JSON.stringify(response.headers, null, 2)}`);
            this.isDone = true;
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: this.isDone,
                finalUrl: null,
                datetime: null
            };
        }

        this.wipUrl = refreshHeader.substring(refreshHeader.indexOf("url=") + 4);
        this.isDone = true;
        this.dateTime = new Date();
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: this.isDone,
            finalUrl: this.wipUrl,
            datetime: this.dateTime
        };
    }

    async checkStatus(): Promise<ArchiveSubmissionResult> {
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: this.isDone,
            finalUrl: this.wipUrl,
            datetime: this.dateTime
        };
    }
}