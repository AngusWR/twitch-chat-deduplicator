// Twitch Chat Deduplicator
// A Chrome extension that merges duplicate or similar messages in live Twitch chat to reduce spam and improve readability.
let DEBUG = false;
let MESSAGE_CACHE_TIME = 60000;
let MAX_CACHE_SIZE = 10000;
let IGNORE_CASE = true;
let USE_LEVENSHTEIN = true;
let LEVENSHTEIN_SIMILARITY_THRESHOLD = 0.9;

// Load settings before starting
chrome.storage.sync.get(
	{
		DEBUG,
		MESSAGE_CACHE_TIME,
		MAX_CACHE_SIZE,
		IGNORE_CASE,
		USE_LEVENSHTEIN,
		LEVENSHTEIN_SIMILARITY_THRESHOLD,
	},
	(settings) => {
		DEBUG = settings.DEBUG;
		MESSAGE_CACHE_TIME = settings.MESSAGE_CACHE_TIME;
		MAX_CACHE_SIZE = settings.MAX_CACHE_SIZE;
		IGNORE_CASE = settings.IGNORE_CASE;
		USE_LEVENSHTEIN = settings.USE_LEVENSHTEIN;
		LEVENSHTEIN_SIMILARITY_THRESHOLD = settings.LEVENSHTEIN_SIMILARITY_THRESHOLD;

		// Detect logged-in user
		detectUsernameFromDropdown();

		// Start processing chat
		waitForChat();
		setInterval(checkForPageChange, 1000);
		setInterval(cleanCache, 1000);
	}
);

const cache = new Map();

function log(...args) {
	if (DEBUG) console.log(...args);
}

function normalise(text) {
	return IGNORE_CASE ? text.toLowerCase() : text;
}

function levenshtein(a, b) {
	const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
	for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
	for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
		}
	}
	return matrix[a.length][b.length];
}

function similarity(a, b) {
	const dist = levenshtein(a, b);
	const maxLen = Math.max(a.length, b.length);
	return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function cleanCache() {
	const now = Date.now();
	for (const [key, data] of cache.entries()) {
		if (now - data.lastSeen > MESSAGE_CACHE_TIME) {
			log(`🗑️ Removed from cache: "${key}"`);
			if (data.node && data.originalText) {
				const span = data.node.querySelector('span[data-a-target="chat-line-message-body"]');
				if (span) span.innerText = data.originalText;
			}
			cache.delete(key);
		}
	}
}

const observer = new MutationObserver((mutationsList) => {
	for (const mutation of mutationsList) {
		for (const addedNode of mutation.addedNodes) {
			if (addedNode.nodeType !== 1) continue;

			const body = addedNode.querySelector('span[data-a-target="chat-line-message-body"]');
			if (!body) continue;

			let messageText = "";

			Array.from(body.childNodes).forEach((node) => {
				if (
					node.nodeType === Node.ELEMENT_NODE &&
					node.matches('.text-fragment[data-a-target="chat-message-text"]')
				) {
					messageText += node.innerText.trim() + " ";
				}

				const img = node.querySelector?.("img.chat-image");
				if (img && img.alt) {
					messageText += img.alt.trim() + " ";
				}
			});

			messageText = messageText.trim();
			if (!messageText) continue;

			const normalisedText = normalise(messageText);
			const authorSpan = addedNode.querySelector("[data-a-user]");
			const author = authorSpan?.getAttribute("data-a-user") || "";
			if (author.toLowerCase() === currentUser) {
				log(`🧍 Skipping deduplication for current user (${currentUser}): "${messageText}"`);
				continue;
			}
			let matchKey = null;
			let isExact = false;

			for (const [key, entry] of cache.entries()) {
				const cachedText = normalise(entry.originalText);

				// Skip comparing a message against itself same node
				if (entry.node === addedNode) {
					continue;
				}

				if (normalisedText === cachedText) {
					matchKey = key;
					isExact = true;
					break;
				}

				const isRepetitive = (str) => /^([^\s])\1{2,}$/.test(str); // e.g. "???", "aaa"
				if (!isExact) {
					if (
						isRepetitive(normalisedText) &&
						isRepetitive(cachedText) &&
						normalisedText[0] === cachedText[0]
					) {
						// Match messages like "???" and "??????"
						matchKey = key;
						isExact = false;
						break;
					} else if (USE_LEVENSHTEIN && normalisedText.length <= 100 && cachedText.length <= 100) {
						const sim = similarity(normalisedText, cachedText);
						if (sim >= LEVENSHTEIN_SIMILARITY_THRESHOLD) {
							matchKey = key;
							isExact = false;
							break;
						}
					}
				}
			}

			if (matchKey !== null && cache.has(matchKey)) {
				const entry = cache.get(matchKey);
				entry.count += 1;
				entry.lastSeen = Date.now();

				const matchType = isExact ? "🔁 EXACT match" : "🧩 SIMILAR match";
				log(`${matchType}: "${messageText}" ~ "${entry.originalText}" (x${entry.count})`);

				// 👥 Replace message body with "👥 ×N: message"
				const updateSpan = entry.node.querySelector('span[data-a-target="chat-line-message-body"]');
				if (updateSpan) {
					updateSpan.textContent = `👥 ×${entry.count}: ${entry.originalText}`;
				}

				// 🚫 Hide username
				const usernameSpan = entry.node.querySelector('[data-a-target="chat-message-username"]');
				if (usernameSpan) {
					usernameSpan.textContent = "";
					usernameSpan.style.display = "none";
				}

				// 🚫 Remove badges
				const badgeButtons = entry.node.querySelectorAll('button[data-a-target="chat-badge"]');
				badgeButtons.forEach((badge) => badge.remove());

				// 🚫 Hide the colon after the username
				const colon = entry.node.querySelector('span[aria-hidden="true"]');
				if (colon && colon.textContent.trim() === ":") {
					colon.style.display = "none";
				}

				// 🚫 Hide the duplicate message node
				addedNode.style.display = "none";
				log(`🚫 Hiding message from ${author}: "${messageText}" — matched with "${entry.originalText}"`);
			} else {
				log(`✉️ New message from ${author}: "${messageText}"`);

				// Enforce max cache size (LRU-style)
				if (cache.size >= MAX_CACHE_SIZE) {
					let oldestKey = null;
					let oldestTime = Infinity;
					for (const [key, data] of cache.entries()) {
						if (data.lastSeen < oldestTime) {
							oldestTime = data.lastSeen;
							oldestKey = key;
						}
					}
					if (oldestKey) {
						cache.delete(oldestKey);
						log(`🗑️ LRU evicted: "${oldestKey}"`);
					}
				}

				cache.set(messageText, {
					count: 1,
					lastSeen: Date.now(),
					node: addedNode,
					originalText: messageText,
					author: author,
				});
			}
		}
	}
});

function waitForChat() {
	const chatContainer = document.querySelector(".chat-scrollable-area__message-container");
	if (chatContainer) {
		log("✅ Chat container found – observing...");
		observer.observe(chatContainer, { childList: true, subtree: true });
	} else {
		log("⏳ Waiting for chat container...");
		setTimeout(waitForChat, 1000);
	}
}

let currentPath = location.pathname;
function checkForPageChange() {
	if (location.pathname !== currentPath) {
		log("🔄 Detected stream/page change");
		currentPath = location.pathname;
		observer.disconnect();
		waitForChat();
	}
}

let currentUser = "";
function detectUsernameFromDropdown() {
	const toggleBtn = document.querySelector('button[data-a-target="user-menu-toggle"]');
	if (!toggleBtn) return;

	toggleBtn.click();

	const interval = setInterval(() => {
		const nameEl = document.querySelector('[data-a-target="user-display-name"]');
		if (nameEl) {
			clearInterval(interval);
			toggleBtn.click();

			currentUser = nameEl.textContent.trim().toLowerCase();
			log(`👤 Detected current user from dropdown: ${currentUser}`);
		}
	}, 250);
}
