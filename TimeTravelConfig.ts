export type TimeTravelConfig = {
    autoTimeTravel: boolean,
    axiosUserAgent: string | null,
    allowlist: {
        [domain: string]: boolean
    },
    mementoDepots: {
        [depotName: string]: {
            timeGate: string,
            fallback: string | null
        }
    }
}
