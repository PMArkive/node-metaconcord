import { NodeSSH } from "node-ssh";
import { TextChannel } from "discord.js";
import { WebApp } from "..";
import config from "@/config/ssh.json";
import servers from "@/config/gamebridge.servers.json";

const HOSTING_IDS = { 3: true };
export default (webApp: WebApp): void => {
	const bot = webApp.container.getService("DiscordBot");

	webApp.app.get("/gamemode/:id/", async (req, res) => {
		const ip = req.header("x-forwarded-for")?.split(",")[0];
		if (!ip) return res.sendStatus(403);
		const isOkIp = servers.find(srv => srv.ip === ip);
		if (!isOkIp) return res.sendStatus(403);

		const id = parseInt(req.params.id);
		if (isNaN(id) || !HOSTING_IDS[id]) {
			return res.sendStatus(403);
		}

		const srvConfig = config.servers[id - 1];
		const ssh = new NodeSSH();
		await ssh.connect({
			username: srvConfig.username,
			host: srvConfig.host,
			port: srvConfig.port,
			privateKeyPath: config.keyPath,
		});

		let output = "";

		await ssh.exec("gserv", ["update_repos", "rehash"], {
			stream: "stderr",
			onStdout: buff => (output += buff),
			onStderr: buff => (output += buff),
		});

		const failed = output.includes("GSERV FAILED");
		if (failed && bot) {
			const guild = await bot.discord.guilds.resolve(bot.config.guildId)?.fetch();
			if (guild) {
				const channel = await guild.channels
					.resolve(bot.config.notificationsChannelId)
					?.fetch();
				await (channel as TextChannel)?.send(
					`<@&${bot.config.appDeveloperRole}> GSERV FAILED ON SERVER ${id}, PLEASE FIX`
				);
			}
		}

		return res
			.status(failed ? 500 : 200)
			.contentType("text/plain")
			.send(output);
	});
};
