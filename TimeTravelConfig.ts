export type TimeTravelConfig = {
    autoTimeTravel: boolean,
    allowlist: {
        [domain: string]: boolean
    },
    priority: string[]
}
