# Time-Travel-Discord-Bot

A Discord bot built on [discord.js](https://discord.js.org/) that looks for archived pages. Uses the [Time Travel API of the Memento project](https://timetravel.mementoweb.org/).

## Usage

For the manual chat command, simply type `!timetravel URL_HERE` and wait for the bot output.

## Setup

1. Install [Node.js](https://nodejs.org/). This has been developed and tested on v14.15.1 on Windows and Ubuntu, but should work on on any platform that v14 Node and newer can run on.
2. Pull or download this repository.
3. Edit configs. Check the [Configuration](#configuration) section for more details.
4. In a terminal in the directory of the extracted folder, simply start the bot with `npm start`.
5. To stop the bot at any time, press `Ctrl+C` in the terminal window.

## Configuration

### .env Configuration

This bot supports either system environment variables or using the `.env` file. Rename `example.env` to `.env`.
System environment variables will be used over the `.env` file.

To use the `.env` file, simply type the value indicated after the equals sign in the `.env` file.
Comments starting with the pound sign `#` are ignored.

* `DISCORD_TOKEN`: A Discord bot token used by your bot to login. Get one from [here](https://discordapp.com/developers/applications/).
* `AUTO_TIME_TRAVEL`: Whether the bot will attempt to look for URLs to auto time travel in all messages.

### priority.json

Ordered list of preferred archive sources. This should be a JSON array. For example:

```json
[
    "archive.today",
    "archive.org"
]
```

### whitelist.json

List of URLs that should be auto time traveled (the command won't have to be manually called). This should be a JSON array. For example:

```json
[
    "example.com",
    "example.org"
]
```

## Known Issues

* Seems you can get rate limited from the API pretty easily. Not quite sure what the limit is.
* Auto time travel is not 100% perfect at detecting URLs in messages.
* There's currently no support for finding a priority archive source that is not in the closest timestamp. This might make the priority feature not work quite as expected.

## Planned Features

* Database based configuration instead of local files
* Chat commands to update whitelist/priority list
