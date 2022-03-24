/*
 * File name: time_travel_bot.js
 * Description: Responsible for time travel mechanics.
 */

const fs = require('fs');
const axios = require('axios').default;
const Discord = require('discord.js');
const linkify = require('linkifyjs');

module.exports = function(discordClient) {
    const CMD_PREFIX = '!';
    const CMD_TIME_TRAVEL = 'timetravel';
    const MEMENTO_URL = 'https://timetravel.mementoweb.org/api/json';
    const AUTO_TIME_TRAVEL = process.env.AUTO_TIME_TRAVEL === 'true';
    let WHITELIST = [];
    let PRIORITY = [];
    const COLOR_CMD = 0x8C8F91; // discord message grey
    const COLOR_SUCCESS = 0x00FF00; // green
    const COLOR_ERR = 0xFF0000; // red

    const getFormattedTime = function(date) {
        if (date === undefined) {
            date = new Date();
        }

        let isoStr = date.toISOString(); // 2011-10-05T14:48:00.000Z

        return isoStr.split('.')[0]
            .replace(/-/g, '')
            .replace(/T/g, '')
            .replace(/:/g, '');
    };

    const isValidUrl = function(str) {
        try {
            let url = new URL(str);
            return true;
        } catch (error) {
            return false;
        }
    };

    const callMementoApi = async function(dateStr, url) {
        const fullUrl = `${MEMENTO_URL}/${dateStr}/${url}`;
        console.log(`Calling GET ${fullUrl}`);

        try {
            let response = await axios.get(fullUrl);

            let status = response.status;
            if (status === 200) {
                let closest = response.data.mementos.closest;
                console.log(`Success on GET ${fullUrl}:\n${JSON.stringify(closest)}`);

                let found = null;
                for (let priorityHost of PRIORITY) {
                    for (let archiveStr of closest.uri) {
                        let archiveUrl = new URL(archiveStr);
                        if (archiveUrl.hostname === priorityHost.trim()) {
                            found = archiveStr;
                            break;
                        }
                    }
                }

                if (found === null) {
                    found = closest.uri[0];
                }

                return {
                    'datetime': closest.datetime,
                    'url': found,
                    'error': null
                };
            } else if (status === 302 || status === 404) {
                console.log(`Nothing found on GET ${fullUrl}`)
                return {
                    'datetime': null,
                    'url': null,
                    'error': 'No Mementos found.'
                };
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error(`Axios error while calling GET ${fullUrl}:\n${error.response.status} ${error.response.data}`);
                return {
                    'datetime': null,
                    'url': null,
                    'error': error.response.status
                };
            } else {
                console.error(`Non-Axios error while calling GET ${fullUrl}:\n${error}`);
                return {
                    'datetime': null,
                    'url': null,
                    'error': error
                };
            }
        }
    };

    const timeTravel = async function(channel, url, originalMsg) {
        console.log(`timeTravel(): ${url}`);
        if (originalMsg !== undefined) {
            originalMsg.suppressEmbeds(true)
                .catch((err) => {
                    console.log('could not suprpress embeds');
                });
        }

        let valid = isValidUrl(url);
        if (!valid) {
            const failEmbed = new Discord.MessageEmbed()
            .setColor(COLOR_ERR)
            .setTitle('Error while time traveling')
            .addFields(
                { name: 'Reason', value: 'Invalid URL' }
            );
            channel.send({ embeds: [failEmbed] });
            return;
        }

        const holdEmbed = new Discord.MessageEmbed()
            .setColor(COLOR_CMD)
            .setTitle('Time traveling, please hold...')
            .addFields(
                { name: 'Original URL', value: url }
            );

        const msg = await channel.send({ embeds: [holdEmbed] });

        let result = await callMementoApi(getFormattedTime(), url);
        if (result.error === null) {
            const successEmbed = new Discord.MessageEmbed()
                .setColor(COLOR_SUCCESS)
                .setTitle('Time travel successful')
                .addFields(
                    { name: 'Memento URL', value: result.url },
                    { name: 'Original URL', value: url }
                )
                .setFooter(`Timestamp of Memento: ${result.datetime}`);
            msg.edit({ embeds: [successEmbed] });
        } else {
            const failEmbed = new Discord.MessageEmbed()
                .setColor(COLOR_ERR)
                .setTitle('Error while time traveling')
                .addFields(
                    { name: 'Reason', value: result.error.toString() },
                    { name: 'Original URL', value: url }
                );
            msg.edit({ embeds: [failEmbed] });
        }
    };

    const handleAuto = async function(channel, msgContent) {
        let linkifyResults = linkify.find(msgContent, 'url');
        if (linkifyResults.length === 0) {
            return;
        }

        let urls = new Set();
        for (let result of linkifyResults) {
            try {
                let url = new URL(result.href);
                if (url.pathname === '/') {
                    continue;
                }

                let hostname = url.hostname;
                if (hostname.startsWith('www.')) {
                    hostname = hostname.substring(4);
                }

                if (WHITELIST.includes(hostname)) {
                    urls.add(result.href);
                }
            } catch (error) {
                //
            }
        }

        if (urls.length === 0) {
            return;
        }

        console.log(`handleAuto(): May have found URLs: ${JSON.stringify(Array.from(urls))}`);

        let promises = [];
        for (url of urls) {
            promises.push(timeTravel(channel, url));
            await new Promise(resolve => setTimeout(resolve, 1000)); // rate limit if we move too fast
        }

        await Promise.allSettled(promises);
        console.log('handleAuto() finished');
    };

    discordClient.on('messageCreate', async (msg) => {
        let msgContent = msg.content;
        let channel = msg.channel;

        if (msg.author.id === discordClient.user.id) {
            return;
        }

        if (!msgContent.startsWith(CMD_PREFIX) && !AUTO_TIME_TRAVEL) {
            return;
        }

        if (msgContent.substring(CMD_PREFIX.length).startsWith(CMD_TIME_TRAVEL)) {
            let url = msgContent.substring(CMD_PREFIX.length + CMD_TIME_TRAVEL.length).trim();
            timeTravel(channel, url, msg);
        } else {
            handleAuto(channel, msgContent);
        }
    });

    // ***** init *****
    let priorityFile = fs.readFileSync('priority.json');
    PRIORITY = JSON.parse(priorityFile);

    let whitelistFile = fs.readFileSync('whitelist.json');
    WHITELIST = JSON.parse(whitelistFile);
};