"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
// inspired by https://github.com/parro-it/electron-google-oauth
const electron_1 = require("electron");
const electron_remote_1 = require("@electron/remote");
const events_1 = require("events");
const google_auth_library_1 = require("google-auth-library");
const querystring_1 = require("querystring");
const url = require("url");
const LoopbackRedirectServer_1 = require("./LoopbackRedirectServer");
const BW = process.type === 'renderer' ? electron_remote_1.BrowserWindow : electron_1.BrowserWindow;
class UserClosedWindowError extends Error {
    constructor() {
        super('User closed the window');
    }
}
exports.UserClosedWindowError = UserClosedWindowError;
exports.defaultElectronGoogleOAuth2Options = {
    successRedirectURL: 'https://getstation.com/app-login-success/',
    // can't be randomized
    loopbackInterfaceRedirectionPort: 42813,
    refocusAfterSuccess: true,
};
/**
 * Handle Google Auth processes through Electron.
 * This class automatically renews expired tokens.
 * @fires ElectronGoogleOAuth2#tokens
 */
class ElectronGoogleOAuth2 extends events_1.EventEmitter {
    /**
     * Create a new instance of ElectronGoogleOAuth2
     * @param {string} clientId - Google Client ID
     * @param {string} clientSecret - Google Client Secret
     * @param {string[]} scopes - Google scopes. 'profile' and 'email' will always be present
     * @param {Partial<ElectronGoogleOAuth2Options>} options
     */
    constructor(clientId, clientSecret, scopes, options = exports.defaultElectronGoogleOAuth2Options) {
        super();
        // Force fetching id_token if not provided
        if (!scopes.includes('profile'))
            scopes.push('profile');
        if (!scopes.includes('email'))
            scopes.push('email');
        this.scopes = scopes;
        this.options = Object.assign(Object.assign({}, exports.defaultElectronGoogleOAuth2Options), options);
        this.oauth2Client = new google_auth_library_1.OAuth2Client(clientId, clientSecret, `http://127.0.0.1:${this.options.loopbackInterfaceRedirectionPort}/callback`);
        this.oauth2Client.on('tokens', (tokens) => {
            this.emit('tokens', tokens);
        });
    }
    /**
     * Returns authUrl generated by googleapis
     * @param {boolean} forceAddSession
     * @returns {string}
     */
    generateAuthUrl(forceAddSession = false) {
        let url = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: this.scopes,
            redirect_uri: `http://127.0.0.1:${this.options.loopbackInterfaceRedirectionPort}/callback`
        });
        if (forceAddSession) {
            const qs = querystring_1.stringify({ continue: url });
            url = `https://accounts.google.com/AddSession?${qs}`;
        }
        return url;
    }
    /**
     * Get authorization code for underlying authUrl
     * @param {boolean} forceAddSession
     * @returns {Promise<string>}
     */
    getAuthorizationCode(forceAddSession = false) {
        const url = this.generateAuthUrl(forceAddSession);
        return this.openAuthWindowAndGetAuthorizationCode(url);
    }
    /**
     * Get authorization code for given url
     * @param {string} urlParam
     * @returns {Promise<string>}
     */
    openAuthWindowAndGetAuthorizationCode(urlParam) {
        return this.openAuthPageAndGetAuthorizationCode(urlParam);
    }
    openAuthPageAndGetAuthorizationCode(urlParam) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.server) {
                // if a server is already running, we close it so that we free the port
                // and restart the process
                yield this.server.close();
                this.server = null;
            }
            this.server = new LoopbackRedirectServer_1.default({
                port: this.options.loopbackInterfaceRedirectionPort,
                callbackPath: '/callback',
                successRedirectURL: this.options.successRedirectURL,
            });
            electron_1.shell.openExternal(urlParam);
            const reachedCallbackURL = yield this.server.waitForRedirection();
            // waitForRedirection will close the server
            this.server = null;
            const parsed = url.parse(reachedCallbackURL, true);
            if (parsed.query.error) {
                throw new Error(parsed.query.error_description);
            }
            else if (!parsed.query.code) {
                throw new Error('Unknown');
            }
            if (this.options.refocusAfterSuccess) {
                // refocus on the window
                BW.getAllWindows().filter(w => w.isVisible()).forEach(w => w.show());
            }
            return parsed.query.code;
        });
    }
    /**
     * Get Google tokens for given scopes
     * @param {boolean} forceAddSession
     * @returns {Promise<Credentials>}
     */
    openAuthWindowAndGetTokens(forceAddSession = false) {
        return this
            .getAuthorizationCode(forceAddSession)
            .then((authorizationCode) => {
            return this.oauth2Client
                .getToken(authorizationCode)
                .then(response => {
                this.oauth2Client.setCredentials(response.tokens);
                return response.tokens;
            });
        });
    }
    setTokens(tokens) {
        this.oauth2Client.setCredentials(tokens);
    }
}
exports.default = ElectronGoogleOAuth2;
