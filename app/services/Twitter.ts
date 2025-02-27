import { ApiResponseError, TweetExtendedEntitiesV1, TweetV1, TwitterApi } from "twitter-api-v2";
import { Container } from "@/app/Container";
import { Service } from ".";
import Filter from "bad-words";
import axios from "axios";
import config from "@/config/twitter.json";
import jwt from "jsonwebtoken";

// const FOLLOWER_REFRESH_RATE = 600000; // 10 mins
// const RATE_LIMIT_REFRESH_RATE = 7200000; // 2 hours
// const TWEET_COUNT_LIMIT = 100;
// const RANDOM_REPLY_PERC = 5 / 100;
export class Twitter extends Service {
	name = "Twitter";
	filter = new Filter();
	twit = new TwitterApi({
		appKey: config.consumer_key,
		appSecret: config.consumer_secret,
		accessToken: config.access_token,
		accessSecret: config.access_token_secret,
	});
	followerIds: Array<string> = [];
	//followerStream: twit.Stream;
	tweetCount = 0;

	constructor(container: Container) {
		super(container);
		// this.refreshFollowers();
		// setInterval(this.refreshFollowers.bind(this), FOLLOWER_REFRESH_RATE);
		// setInterval(() => (this.tweetCount = 0), RATE_LIMIT_REFRESH_RATE);
	}

	// private async refreshFollowers() {
	// 	const res = (await this.twit.get("followers/ids.json", {
	// 		screen_name: "metastruct",
	// 	})) as Array<number>;
	// 	if (res) {
	// 		this.followerIds = res.map(id => id.toString());
	// 		// this.initializeFollowerStream();
	// 	}
	// }

	// private canReply(data: TweetV1): boolean {
	// 	if (data.user.protected) return false; // don't reply to users that are "protected"
	// 	if (data.user.id_str === config.id) return false; // don't answer yourself :v

	// 	// make sure we don't reply to retweets of our own stuff
	// 	if (data.retweeted && data.retweeted_status?.user?.id_str === config.id) return false;
	// 	if (data.is_quote_status && data.quoted_status?.user?.id_str === config.id) return false;

	// 	return true;
	// }

	// private initializeFollowerStream(): void {
	// 	this.followerStream?.stop(); // just in case it already exists
	// 	this.followerStream = this.twit.stream("statuses/filter", {
	// 		follow: this.followerIds,
	// 		track: "metastruct",
	// });

	// this.followerStream.on("tweet", (data: twit.Twitter.Status) => {
	// 	if (!this.canReply(data)) return;

	// 	const mentions = data.entities.user_mentions.map(mention => mention.id_str);
	// 	const isMentioned = mentions.includes(config.id);
	// 	if (isMentioned || data.in_reply_to_user_id_str === config.id) {
	// 		this.replyMarkovToStatus(data.id_str);
	// 		return;
	// 	}

	// 	if (data.retweeted || data.is_quote_status || data.possibly_sensitive) return;
	// 	if (!this.followerIds.includes(data.user.id_str)) return; // apparently twitter api gives us non follower tweets

	// 	if (Math.random() <= RANDOM_REPLY_PERC) {
	// 		this.replyMarkovToStatus(data.id_str);
	// 	}
	// });
	// }

	// private async replyMarkovToStatus(statusId: string): Promise<void> {
	// 	if (this.tweetCount >= TWEET_COUNT_LIMIT) return;

	// 	let gen = this.container.getService("Markov").generate();
	// 	gen = this.filter.clean(gen);
	// 	const newTweetResp = await this.twit.post("statuses/update", {
	// 		status: gen,
	// 		in_reply_to_status_id: statusId,
	// 		auto_populate_reply_metadata: true,
	// 	});
	// 	this.tweetCount++;

	// 	// check for deletion later
	// 	setTimeout(async () => {
	// 		const res = await this.twit.get("statuses/lookup", { id: statusId });
	// 		if ((res.data as Array<twit.Twitter.Status>).length > 0) return;

	// 		const newTweet = newTweetResp.data as twit.Twitter.Status;
	// 		await this.twit.post("statuses/destroy", {
	// 			id: newTweet.id_str,
	// 		});
	// 	}, FOLLOWER_REFRESH_RATE);
	// }

	public async postStatus(status: string, imageUrl?: string): Promise<void> {
		if (status.length < 2 || status.length > 279) return;

		const time = Math.floor(new Date().getTime() / 1000);
		const data = {
			tweet: this.filter.clean(status),
			exp: time + 3600,
			iat: time,
			iss: "#motd",
			furl: imageUrl,
		};

		const token = jwt.sign(data, config.token);
		const ret = await axios.get(`http://g2.metastruct.net:20080/dotweet?token=${token}`);
		if (ret.status !== 200) {
			if (ret.status == 503 && ret.headers["Retry-After"]) {
				const timeout: number = new Number(ret.headers["Retry-After"]).valueOf();
				setTimeout(() => this.postStatus(status, imageUrl), timeout);
			}
		}
	}

	public async deleteLastIotd(): Promise<void> {
		const paginator = await this.twit.v1.homeTimeline();
		if (paginator.tweets.length === 0) return;
		const statuses = paginator.tweets;
		const lastIotd = statuses
			.filter(
				status =>
					status.user.id_str === config.id &&
					status.full_text?.includes("Image of the day")
			)
			.sort()[0];
		if (!lastIotd) return;
		const msgId = lastIotd.id_str;
		await this.twit.v1.deleteTweet(msgId);
	}

	public async getStatusMediaURLs(url: string): Promise<Array<string>> {
		try {
			const matches = url.match(/[0-9]+$/);
			if (!matches) return [];
			const statusId = matches[0];
			let res: TweetV1;
			try {
				res = await this.twit.v1.singleTweet(statusId, { tweet_mode: "extended" });
			} catch (err) {
				if (err instanceof ApiResponseError && err.code !== 403) {
					console.error(err);
				}
				return [];
			}

			if (!res) return [];

			const status = res;
			if (!status.extended_entities || !status.extended_entities.media) return [];

			return status.extended_entities.media
				.filter(media => media.type !== "photo")
				.map(media => {
					const data = media as any;
					if (data.video_info) {
						const variants = data.video_info.variants
							.filter(
								(variant: { content_type: string }) =>
									variant.content_type === "video/mp4"
							)
							.sort(
								(x: { bitrate: number }, y: { bitrate: number }) =>
									x.bitrate - y.bitrate
							);
						const variant = variants[variants.length - 1];
						if (variant?.url) return variant.url;
					}

					return media.media_url_https;
				});
		} catch (err) {
			console.error(err);
			return [];
		}
	}
}

export default (container: Container): Service => {
	return new Twitter(container);
};
