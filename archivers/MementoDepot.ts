import axios from "axios";

export type Memento = {
    status: number,
    url: string | null,
    datetime: Date | null
};

export class MementoDepot {
    private static readonly MEMENTO_DATETIME_REGEX = new RegExp(String.raw`([0-9]{14})`);

    private readonly timeGatePrefix: string;
    private readonly fallbackPrefix: string | null;

    constructor(timeGatePrefix: string, fallbackPrefix: string | null) {
        this.timeGatePrefix = timeGatePrefix;
        this.fallbackPrefix = fallbackPrefix;
    }

    async getLatestMemento(url: string): Promise<Memento> {
        const fullUrl = `${this.timeGatePrefix}${url}`;
        console.log(`[MementoDepot] Calling getLatestMemento() using url ${fullUrl}`);
        const response = await axios.get(fullUrl, { validateStatus: () => true });
        const status = response.status;
        if (status >= 400) {
            console.error(`[MementoDepot] Got status code ${status} on from ${fullUrl}`);
            return {
                status: status,
                url: null,
                datetime: null
            };
        }

        let mementoUrl: string | undefined = response.headers["location"];
        if (mementoUrl !== undefined) {
            console.log(`[MementoDepot] getLatestMemento() got mementoUrl ${mementoUrl} from location header`);
        } else {
            const linkHeader: string | undefined = response.headers["link"];
            if (linkHeader === undefined) {
                console.error(`[MementoDepot] getLatestMemento() could not determine latest memento or location for ${fullUrl}`);
                return {
                    status: status,
                    url: null,
                    datetime: null
                };
            }

            const linkArray = linkHeader.split(",");
            for (const entry of linkArray) {
                // eslint-disable-next-line quotes
                if (!entry.includes('rel="last memento";')) {
                    continue;
                }

                mementoUrl = entry.substring(entry.indexOf("<") + 1, entry.indexOf(">"));
            }

            console.log(`[MementoDepot] getLatestMemento() got mementoUrl ${mementoUrl} from link header`);
        }

        if (mementoUrl === undefined) {
            console.error(`[MementoDepot] getLatestMemento() could not determine latest memento or location for ${fullUrl}`);
            return {
                status: status,
                url: null,
                datetime: null
            };
        }

        const mementoDate = this.getDateFromMementoUrl(mementoUrl);
        return {
            status: status,
            url: mementoUrl,
            datetime: mementoDate
        };
    }

    getDateFromMementoUrl(url: string): Date | null {
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