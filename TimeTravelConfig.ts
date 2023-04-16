export type TimeTravelConfig = {
    autoTimeTravel: boolean,
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
