// thank u mr swadical https://github.com/SwadicalRag/node-markov-lite
import * as sqlite from "sqlite3";
import { Container } from "../Container";
import { Service } from ".";
interface ILearnData {
	timestamp?: number;
	message: string;
	authorID?: string;
	authorName: string;
}

interface IGenerateOptions {
	depth?: number;
	length?: number;
	authorID?: string;
	continuation?: boolean;
}

abstract class MarkovChainBase {
	abstract learn(data: ILearnData): Promise<void>;
	abstract queryDB(chain: string[], authorID?: string): Promise<ILearnData | null>;

	private getWords(sentence: string) {
		if (sentence.match(/^\s*$/)) {
			return [];
		}

		return sentence.split(/\s+/g);
	}

	private getCurrentChain(words: string[], depth = 2) {
		const out: string[] = [];

		for (let i = 0; i < depth; i++) {
			if (words[words.length - depth + i]) {
				out.push(words[words.length - depth + i]);
			}
		}

		return out;
	}

	private matchCurrentChain(words: string[], chain: string[], depth = 2) {
		let out: string[] = [];
		const chains: string[][] = [];

		for (let i = 0; i < words.length; i++) {
			const word = words[i].toLocaleLowerCase();

			if (!chain[0] || word == chain[0].toLocaleLowerCase()) {
				let acceptable = true;

				for (let i2 = 0; i2 < chain.length; i2++) {
					if (
						!words[i + i2] ||
						chain[i2].toLocaleLowerCase() != words[i + i2].toLocaleLowerCase()
					) {
						acceptable = false;
						break;
					}
				}

				if (acceptable) {
					if (chain.length < depth) {
						for (let i2 = i; i2 < Math.min(i + depth, words.length); i2++) {
							out.push(words[i2]);
						}
					} else {
						for (let i2 = 1; i2 < chain.length; i2++) {
							out.push(chain[i2]);
						}

						if (words[i + chain.length]) {
							out.push(words[i + chain.length]);
						}
					}

					chains.push(out);
					out = [];
					acceptable = false;
				}
			}
		}

		return chains[Math.round(Math.random() * (chains.length - 1))] || out;
	}

	async generate(
		depth = 3,
		maxLength = 50,
		sentence = "",
		authorID = "",
		continuation = true,
		callback?: (word: string) => void
	): Promise<string | undefined> {
		let words = this.getWords(sentence);
		let chain = this.getCurrentChain(words, depth);

		const out: string[] = [];

		if (continuation) {
			for (const word of words) {
				out.push(word);
				if (callback) {
					callback(word);
				}
			}
		}

		let lastChain: string[];
		const startCount = out.length;

		while (out.length < maxLength) {
			const data = await this.queryDB(chain, authorID);

			if (!data || !data.message) {
				break;
			}

			words = this.getWords(data.message);

			lastChain = chain;
			chain = this.matchCurrentChain(words, chain, depth);

			if (chain.length - lastChain.length <= 0 && chain.length < depth) {
				break;
			} else if (lastChain.length < depth) {
				for (let i = lastChain.length; i < chain.length; i++) {
					out.push(chain[i]);
					if (callback) {
						callback(chain[i]);
					}
				}
			} else {
				out.push(chain[chain.length - 1]);
				if (callback) {
					callback(chain[chain.length - 1]);
				}
			}
		}

		return out.length > startCount ? out.join(" ") : undefined;
	}
}

class MarkovChain extends MarkovChainBase {
	db: sqlite.Database;

	constructor(public location: string) {
		super();

		this.db = new sqlite.Database(this.location);

		this.db.serialize(() => {
			this.ready();
		});
	}

	ready(): void {
		this.db.run(
			"CREATE TABLE IF NOT EXISTS markov (`timestamp` DATETIME, `authorID` VARCHAR(255), `authorName` VARCHAR(255), `message` VARCHAR(255));"
		);
	}

	learn(data: ILearnData): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			data.message = data.message.trim().replace(/\s+/g, " "); // standardise whitespace

			this.db.run(
				"INSERT INTO markov VALUES ($timestamp, $authorID, $authorName, $message)",
				{
					$timestamp: Math.round((data.timestamp || Date.now()) / 1000),
					$authorID: data.authorID,
					$authorName: data.authorName,
					$message: data.message,
				},
				err => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				}
			);
		});
	}

	queryDB(chain: string[], authorID: string): Promise<ILearnData | null> {
		return new Promise((resolve, reject) => {
			const sentence = chain.join(" ");

			if (sentence.trim() === "") {
				this.db.get(
					`SELECT * FROM markov ${
						authorID ? `WHERE authorID = ${authorID}` : ""
					} ORDER BY RANDOM() LIMIT 1`,
					(err, res) => {
						if (err) {
							reject(err);
						} else {
							resolve(res);
						}
					}
				);
			} else {
				this.db.all(
					`SELECT * FROM markov WHERE ${
						authorID ? `authorID = ${authorID} AND` : ""
					}(message LIKE $sentence1 OR [message] Like $sentence3 ) ORDER BY RANDOM() LIMIT 1`,
					{
						$sentence1: `_% ${sentence} %_`,
						// $sentence2: `% ${sentence}`,
						$sentence3: `${sentence} %_`,
						// $sentence4: `${sentence}`,
					},
					(err, resArr) => {
						if (err) {
							reject(err);
						} else {
							for (const res of resArr) {
								if (!res.message.endsWith(sentence)) {
									resolve(res);
									return;
								}
							}
							resolve(null);
						}
					}
				);
			}
		});
	}
}
export class MarkovService extends Service {
	name = "Markov";
	markov = new MarkovChain("./metaconcord.db");

	async learn(data: ILearnData): Promise<void> {
		await this.markov.learn(data);
	}

	async generate(sentence?: string, options?: IGenerateOptions): Promise<string | undefined> {
		try {
			return await this.markov.generate(
				options?.depth,
				options?.length,
				sentence,
				options?.authorID,
				options?.continuation
			);
		} catch (err) {
			console.error(err);
			return;
		}
	}

	// private sanitizeString(input: string): string {  // unsure if still needed?
	// 	if (!input) return "";

	// 	return input
	// 		.replace(/\(|\)|\[|\]|\@|\<|\>|\"|\{|\}|\\|\,|\.|\;/g, "")
	// 		.replace(/-|\t|_|\n/g, " ")
	// 		.replace(/\s{2,}/g, " ")
	// 		.trim();
	// }
}

export default (container: Container): Service => {
	return new MarkovService(container);
};
