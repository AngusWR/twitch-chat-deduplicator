const defaults = {
	DEBUG: false,
	MESSAGE_CACHE_TIME: 60000,
	MAX_CACHE_SIZE: 10000,
	IGNORE_CASE: true,
	USE_LEVENSHTEIN: true,
	LEVENSHTEIN_SIMILARITY_THRESHOLD: 0.9
  };
  
  function loadSettings() {
	chrome.storage.sync.get(defaults, (items) => {
	  document.getElementById('debug').checked = items.DEBUG;
	  document.getElementById('messageCacheTime').value = items.MESSAGE_CACHE_TIME;
	  document.getElementById('maxCacheSize').value = items.MAX_CACHE_SIZE;
	  document.getElementById('ignoreCase').checked = items.IGNORE_CASE;
	  document.getElementById('useLevenshtein').checked = items.USE_LEVENSHTEIN;
	  document.getElementById('levenshteinThreshold').value = items.LEVENSHTEIN_SIMILARITY_THRESHOLD;
	});
  }
  
  function showStatus(message, timeout = 2000) {
	const status = document.getElementById("status");
	status.textContent = message;
	setTimeout(() => (status.textContent = ''), timeout);
  }
  
  document.addEventListener("DOMContentLoaded", () => {
	loadSettings();
  
	document.getElementById("save").addEventListener("click", () => {
	  const settings = {
		DEBUG: document.getElementById('debug').checked,
		MESSAGE_CACHE_TIME: parseInt(document.getElementById('messageCacheTime').value),
		MAX_CACHE_SIZE: parseInt(document.getElementById('maxCacheSize').value),
		IGNORE_CASE: document.getElementById('ignoreCase').checked,
		USE_LEVENSHTEIN: document.getElementById('useLevenshtein').checked,
		LEVENSHTEIN_SIMILARITY_THRESHOLD: parseFloat(document.getElementById('levenshteinThreshold').value)
	  };
	  chrome.storage.sync.set(settings, () => {
		showStatus("Settings saved");
	  });
	});
  
	document.getElementById("reset").addEventListener("click", () => {
	  chrome.storage.sync.set(defaults, () => {
		loadSettings();
		showStatus("Settings reset to defaults");
	  });
	});
  });
  