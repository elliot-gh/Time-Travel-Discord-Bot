import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

export type Memento = {
    status: number,
    url: string | null,
    datetime: Date | null
};

export class MementoDepot {
    private static readonly MEMENTO_DATETIME_REGEX = new RegExp(String.raw`([0-9]{14})`);

    private readonly timeGatePrefix: string;
    private readonly fallbackPrefix: string | null;
    private readonly userAgent: string | null;

    constructor(timeGatePrefix: string, fallbackPrefix: string | null, userAgent: string | null) {
        this.timeGatePrefix = timeGatePrefix;
        this.fallbackPrefix = fallbackPrefix;
        this.userAgent = userAgent;
    }

    async getLatestMemento(url: string): Promise<Memento> {
        const fullUrl = `${this.timeGatePrefix}${url}`;
        console.log(`[MementoDepot] Calling getLatestMemento() using url ${fullUrl}`);
        const axiosConfig: AxiosRequestConfig = {
            validateStatus: () => true
        };

        if (this.userAgent !== null) {
            axiosConfig.headers = {
                "User-Agent": this.userAgent
            };
        }

        const response = await axios.get(fullUrl, axiosConfig);
        const status = response.status;
        if (status >= 400) {
            console.error(`[MementoDepot] Got status code ${status} on from ${fullUrl}`);
            return {
                status: status,
                url: null,
                datetime: null
            };
        }

        const mementoUrl = MementoDepot.parseResponseHeaders(response.headers);
        return {
            status: status,
            url: mementoUrl,
            datetime: mementoUrl === null ? null : MementoDepot.getDateFromMementoUrl(mementoUrl)
        };
    }

    static parseResponseHeaders(headers: AxiosResponse["headers"]): string | null {
        let mementoUrl: string | undefined = headers["location"];
        if (mementoUrl !== undefined) {
            console.log(`[MementoDepot] parseResponseHeaders() got mementoUrl ${mementoUrl} from location header`);
            return mementoUrl;
        } else {
            const linkHeader: string | undefined = headers["link"];
            if (linkHeader === undefined) {
                console.error(`[MementoDepot] parseResponseHeaders() could not determine latest memento or location from headers:\n${JSON.stringify(headers, null, 2)}`);
                return null;
            }

            const linkArray = linkHeader.split(",");
            if (linkArray.length === 0) {
                console.error(`[MementoDepot] parseResponseHeaders() got linkHeader.length===0 from headers:\n${JSON.stringify(headers, null, 2)}`);
                return null;
            }

            for (const entry of linkArray) {
                // eslint-disable-next-line quotes
                if (!entry.includes('rel="last memento"')) {
                    continue;
                }

                mementoUrl = entry.substring(entry.indexOf("<") + 1, entry.indexOf(">"));
                console.log(`[MementoDepot] parseResponseHeaders() got mementoUrl ${mementoUrl} from link header`);
                return mementoUrl;
            }

            // if "last memento" not found, try find a link working backwards
            if (mementoUrl === undefined) {
                for (let entryIndex = linkArray.length - 1; entryIndex >= 0; entryIndex--) {
                    const entry = linkArray[entryIndex];
                    if (!entry.includes("memento")) {
                        continue;
                    }

                    const beginningIndex = entry.indexOf("<");
                    const endingIndex = entry.indexOf(">");
                    if (beginningIndex < 0 && endingIndex < 0) {
                        continue;
                    }

                    mementoUrl = entry.substring(beginningIndex + 1, endingIndex);
                    console.log(`[MementoDepot] parseResponseHeaders() got mementoUrl ${mementoUrl} but could not find last memento entry`);
                    return mementoUrl;
                }
            }

            console.log(`[MementoDepot] parseResponseHeaders() got mementoUrl ${mementoUrl} from link header`);
        }

        console.error(`[MementoDepot] parseResponseHeaders() could not determine latest memento or location from headers:\n${JSON.stringify(headers, null, 2)}`);
        return null;
    }

    static getDateFromMementoUrl(url: string): Date | null {
        try {
            const regexMatches = url.match(MementoDepot.MEMENTO_DATETIME_REGEX);
            if (regexMatches === null || regexMatches.length < 1) {
                throw new Error(`No regex matches found for ${url}`);
            }

            const mementoDateStr = regexMatches[0];
            return MementoDepot.datetimeStringToDateTime(mementoDateStr);
        } catch (error) {
            console.error(`[MementoDepot] Error parsing memento date from url ${url}:\n${error}`);
            return null;
        }
    }

    getFallbackUrl(url: string): string | null {
        if (this.fallbackPrefix === null) {
            return null;
        }

        const fullUrl = `${this.fallbackPrefix}${url}`;
        console.log(`[MementoDepot] getFallbackUrl() returning url ${fullUrl}`);
        return fullUrl;
    }

    static datetimeStringToDateTime(datetimeString: string): Date | null {
        if (datetimeString.length !== 14) {
            console.error(`[MementoDepot] Memento date is not 14 characters long, got ${datetimeString}`);
            return null;
        }

        try {
            const year = parseInt(datetimeString.substring(0, 4));
            const month = parseInt(datetimeString.substring(4, 6));
            const day = parseInt(datetimeString.substring(6, 8));
            const hour = parseInt(datetimeString.substring(8, 10));
            const minute = parseInt(datetimeString.substring(10, 12));
            const seconds = parseInt(datetimeString.substring(12, 14));
            return new Date(year, month, day, hour, minute, seconds);
        } catch (error) {
            console.error(`[MementoDepot] datetimeStringToDateTime() Error parsing datetime string ${datetimeString}:\n${error}`);
            return null;
        }
    }
}