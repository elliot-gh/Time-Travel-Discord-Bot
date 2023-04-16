/* eslint-disable no-unused-vars */

export type ArchiveSubmissionResult = {
    originalUrl: string,
    statusCode: number | null,
    isDone: boolean,
    finalUrl: string | null
};

/**
 * @throws {NoResubmitError}
 */
export interface IArchiveSubmission {
    readonly name: string;
    readonly originalUrl: string;
    submit(): Promise<ArchiveSubmissionResult>;
    checkStatus(): Promise<ArchiveSubmissionResult>;
}