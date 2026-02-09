const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;
const storageScope = isNode
	? 'node'
	: (window.location.hostname || 'localhost').replace(/[^a-zA-Z0-9_-]/g, '_');

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false, allowLegacyStorage = true } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const baseKey = `base44_${toSnakeCase(paramName)}`;
	const storageKey = `${baseKey}_${storageScope}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	if (allowLegacyStorage) {
		const legacyStoredValue = storage.getItem(baseKey);
		if (legacyStoredValue) {
			storage.setItem(storageKey, legacyStoredValue);
			return legacyStoredValue;
		}
	}
	return null;
}

const getAppParams = () => {
	if (getAppParamValue("clear_access_token") === 'true') {
		storage.removeItem('base44_access_token');
		storage.removeItem('token');
	}
	const urlParams = isNode ? new URLSearchParams() : new URLSearchParams(window.location.search);
	const functionsVersionFromUrl = urlParams.get("functions_version");
	const functionsVersionFromEnv = import.meta.env.VITE_BASE44_FUNCTIONS_VERSION || null;
	// Do not keep a stale functions_version pinned in localStorage.
	if (!functionsVersionFromUrl) {
		storage.removeItem('base44_functions_version');
		storage.removeItem(`base44_functions_version_${storageScope}`);
	}
	return {
		appId: getAppParamValue("app_id", { defaultValue: import.meta.env.VITE_BASE44_APP_ID, allowLegacyStorage: false }),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion: functionsVersionFromUrl || functionsVersionFromEnv,
		appBaseUrl: getAppParamValue("app_base_url", { defaultValue: import.meta.env.VITE_BASE44_APP_BASE_URL, allowLegacyStorage: false }),
	}
}


export const appParams = {
	...getAppParams()
}
