/* eslint-disable no-unused-vars */

export type ArchiveSubmissionResult = {
    originalUrl: string,
    statusCode: number | null,
    isDone: boolean,
    finalUrl: string | null,
    datetime: Date | null
};

/**
 * @throws {NoResubmitError}
 */
export interface IArchiveSubmission {
    readonly name: string;
    readonly originalUrl: string;
    readonly userAgent: string | null;
    readonly waitBetweenStatus: number | null;
    submit(): Promise<ArchiveSubmissionResult>;
    checkStatus(): Promise<ArchiveSubmissionResult>;
}