import { ArchiveSubmissionResult, IArchiveSubmission } from "./IArchiveSubmission";
import axios, { AxiosRequestConfig } from "axios";
import { MementoDepot } from "./MementoDepot";

/**
 * test using POST + form data, and querying job status
 */
export class InternetArchiveSubmissionJob implements IArchiveSubmission {
    private static readonly JOB_REGEX = new RegExp(String.raw`Job\("([^ ",\\/:]+)",`, "i");

    readonly name: string;
    readonly originalUrl: string;
    readonly userAgent: string | null;
    readonly waitBetweenStatus = 2000;
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
        const formData = new FormData();
        formData.append("url", this.originalUrl);
        formData.append("capture_all", "on");

        console.log(`[InternetArchiveSubmission] Calling submit() using url ${fullUrl}`);
        const axiosConfig: AxiosRequestConfig = {
            validateStatus: () => true
        };

        if (this.userAgent !== null) {
            axiosConfig.headers = {
                "User-Agent": this.userAgent
            };
        }

        const response = await axios.post(fullUrl, formData, axiosConfig);
        this.statusCode = response.status;
        if (this.statusCode >= 300) {
            this.isDone = true;
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: true,
                finalUrl: null,
                datetime: null
            };
        }

        const responseStr = response.data as string;
        const regexMatches = responseStr.match(InternetArchiveSubmissionJob.JOB_REGEX);
        if (regexMatches === null || regexMatches.length === 0) {
            const errStr = `[InternetArchiveSubmission] Unable to find job ID in response: ${responseStr}`;
            console.error(errStr);
            throw new Error(errStr);
        }

        this.jobId = regexMatches[1];
        this.isDone = false;
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: false,
            finalUrl: null,
            datetime: null
        };
    }

    async checkStatus(): Promise<ArchiveSubmissionResult> {
        if (this.isDone) {
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: true,
                finalUrl: this.finalUrl,
                datetime: this.datetime
            };
        }

        const fullUrl = `https://web.archive.org/save/status/${this.jobId}`;
        console.log(`[InternetArchiveSubmission] Calling checkStatus() using url ${fullUrl}`);
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
        if (this.statusCode >= 300) {
            console.error(`[InternetArchiveSubmission] checkStatus() got status code ${this.statusCode}`);
            this.isDone = true;
            this.finalUrl = null;
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: true,
                finalUrl: null,
                datetime: null
            };
        }

        const responseObj = JSON.parse(response.data as string);
        const archiveStatus = responseObj.status as string;
        console.error(`[InternetArchiveSubmission] checkStatus() got status ${archiveStatus}`);
        if (archiveStatus === "pending") {
            this.isDone = false;
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: false,
                finalUrl: null,
                datetime: null
            };
        } else if (archiveStatus === "success") {
            this.isDone = true;
            const timestampStr = responseObj.timestamp;
            if (timestampStr === undefined) {
                console.error(`[InternetArchiveSubmission] checkStatus() got success but no timestamp:\n${JSON.stringify(response.headers, null, 2)}`);
                this.finalUrl = null;
                return {
                    originalUrl: this.originalUrl,
                    statusCode: this.statusCode,
                    isDone: true,
                    finalUrl: null,
                    datetime: null
                };
            }

            this.datetime = MementoDepot.datetimeStringToDateTime(timestampStr);
            this.finalUrl = this.timestampToMementoUrl(timestampStr);
            return {
                originalUrl: this.originalUrl,
                statusCode: this.statusCode,
                isDone: true,
                finalUrl: this.finalUrl,
                datetime: this.datetime
            };
        }

        console.error(`[InternetArchiveSubmission] checkStatus() got unknown status:\n${JSON.stringify(response.headers, null, 2)}`);
        this.isDone = true;
        this.finalUrl = null;
        return {
            originalUrl: this.originalUrl,
            statusCode: this.statusCode,
            isDone: true,
            finalUrl: null,
            datetime: null
        };
    }

    timestampToMementoUrl(timestampStr: string): string {
        return `https://web.archive.org/web/${timestampStr}/${this.originalUrl}`;
    }
}