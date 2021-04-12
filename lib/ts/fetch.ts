/* Copyright (c) 2020, VRAI Labs and/or its affiliates. All rights reserved.
 *
 * This software is licensed under the Apache License, Version 2.0 (the
 * "License") as published by the Apache Software Foundation.
 *
 * You may not use this file except in compliance with the License. You may
 * obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */
import { PROCESS_STATE, ProcessState } from "./processState";
import { supported_fdi } from "./version";
import Lock from "browser-tabs-lock";
import {
    InputType,
    validateAndNormaliseInputOrThrowError,
    normaliseURLPathOrThrowError,
    normaliseURLDomainOrThrowError,
    getWindowOrThrow
} from "./utils";

export class AntiCsrfToken {
    private static tokenInfo:
        | undefined
        | {
              antiCsrf: string;
              associatedIdRefreshToken: string;
          };

    private constructor() {}

    static getToken(associatedIdRefreshToken: string | undefined): string | undefined {
        if (associatedIdRefreshToken === undefined) {
            AntiCsrfToken.tokenInfo = undefined;
            return undefined;
        }
        if (AntiCsrfToken.tokenInfo === undefined) {
            let antiCsrf = getAntiCSRFToken();
            if (antiCsrf === null) {
                return undefined;
            }
            AntiCsrfToken.tokenInfo = {
                antiCsrf,
                associatedIdRefreshToken
            };
        } else if (AntiCsrfToken.tokenInfo.associatedIdRefreshToken !== associatedIdRefreshToken) {
            // csrf token has changed.
            AntiCsrfToken.tokenInfo = undefined;
            return AntiCsrfToken.getToken(associatedIdRefreshToken);
        }
        return AntiCsrfToken.tokenInfo.antiCsrf;
    }

    static removeToken() {
        AntiCsrfToken.tokenInfo = undefined;
        setAntiCSRF(undefined);
    }

    static setItem(associatedIdRefreshToken: string | undefined, antiCsrf: string) {
        if (associatedIdRefreshToken === undefined) {
            AntiCsrfToken.tokenInfo = undefined;
            return;
        }
        setAntiCSRF(antiCsrf);
        AntiCsrfToken.tokenInfo = {
            antiCsrf,
            associatedIdRefreshToken
        };
    }
}

// Note: We do not store this in memory because another tab may have
// modified this value, and if so, we may not know about it in this tab
export class FrontToken {
    private constructor() {}

    static getTokenInfo():
        | {
              uid: string;
              ate: number;
              up: any;
          }
        | undefined {
        let frontToken = getFrontToken();
        if (frontToken === null) {
            return undefined;
        }
        return JSON.parse(atob(frontToken));
    }

    static removeToken() {
        setFrontToken(undefined);
    }

    static setItem(frontToken: string) {
        setFrontToken(frontToken);
    }
}

/**
 * @description returns true if retry, else false is session has expired completely.
 */
export async function handleUnauthorised(
    refreshAPI: string,
    preRequestIdToken: string | undefined,
    sessionScope: string,
    refreshAPICustomHeaders: any,
    sessionExpiredStatusCode: number
): Promise<boolean> {
    if (preRequestIdToken === undefined) {
        return getIdRefreshToken() !== undefined;
    }
    let result = await onUnauthorisedResponse(
        refreshAPI,
        preRequestIdToken,
        sessionScope,
        refreshAPICustomHeaders,
        sessionExpiredStatusCode
    );
    if (result.result === "SESSION_EXPIRED") {
        return false;
    } else if (result.result === "API_ERROR") {
        throw result.error;
    }
    return true;
}

/**
 * @class AuthHttpRequest
 * @description wrapper for common http methods.
 */
export default class AuthHttpRequest {
    static refreshTokenUrl: string;
    static signOutUrl: string;
    static sessionExpiredStatusCode: number;
    static initCalled = false;
    static originalFetch: any;
    static apiDomain = "";
    static addedFetchInterceptor: boolean = false;
    static sessionScope: string;
    static refreshAPICustomHeaders: any;
    static signoutAPICustomHeaders: any;
    static auth0Path: string | undefined;
    static autoAddCredentials: boolean;

    static setAuth0API(apiPath: string) {
        AuthHttpRequest.auth0Path = normaliseURLPathOrThrowError(apiPath);
    }

    static getAuth0API = () => {
        return {
            apiPath: AuthHttpRequest.auth0Path
        };
    };

    static init(options: InputType) {
        let {
            apiDomain,
            apiBasePath,
            sessionScope,
            refreshAPICustomHeaders,
            signoutAPICustomHeaders,
            sessionExpiredStatusCode,
            autoAddCredentials
        } = validateAndNormaliseInputOrThrowError(options);

        AuthHttpRequest.autoAddCredentials = autoAddCredentials;
        AuthHttpRequest.refreshTokenUrl = apiDomain + apiBasePath + "/session/refresh";
        AuthHttpRequest.signOutUrl = apiDomain + apiBasePath + "/signout";
        AuthHttpRequest.refreshAPICustomHeaders = refreshAPICustomHeaders;
        AuthHttpRequest.signoutAPICustomHeaders = signoutAPICustomHeaders;
        AuthHttpRequest.sessionScope = sessionScope;
        AuthHttpRequest.sessionExpiredStatusCode = sessionExpiredStatusCode;
        AuthHttpRequest.apiDomain = apiDomain;

        let env: any = getWindowOrThrow().fetch === undefined ? global : getWindowOrThrow();
        if (AuthHttpRequest.originalFetch === undefined) {
            AuthHttpRequest.originalFetch = env.fetch.bind(env);
        }
        if (!AuthHttpRequest.addedFetchInterceptor) {
            AuthHttpRequest.addedFetchInterceptor = true;
            env.fetch = (url: RequestInfo, config?: RequestInit): Promise<Response> => {
                return AuthHttpRequest.fetch(url, config);
            };
        }

        AuthHttpRequest.initCalled = true;
    }

    static getRefreshURLDomain = (): string => {
        return normaliseURLDomainOrThrowError(AuthHttpRequest.refreshTokenUrl);
    };

    static getUserId(): string {
        let tokenInfo = FrontToken.getTokenInfo();
        if (tokenInfo === undefined) {
            throw new Error("No session exists");
        }
        return tokenInfo.uid;
    }

    static async getJWTPayloadSecurely(): Promise<any> {
        let tokenInfo = FrontToken.getTokenInfo();
        if (tokenInfo === undefined) {
            throw new Error("No session exists");
        }

        if (tokenInfo.ate < Date.now()) {
            const preRequestIdToken = getIdRefreshToken();
            let retry = await handleUnauthorised(
                AuthHttpRequest.refreshTokenUrl,
                preRequestIdToken,
                AuthHttpRequest.sessionScope,
                AuthHttpRequest.refreshAPICustomHeaders,
                AuthHttpRequest.sessionExpiredStatusCode
            );
            if (retry) {
                return await AuthHttpRequest.getJWTPayloadSecurely();
            } else {
                throw new Error("Could not refresh session");
            }
        }
        return tokenInfo.up;
    }

    static async signOut() {
        if (!AuthHttpRequest.doesSessionExist()) {
            return;
        }

        let resp = await fetch(AuthHttpRequest.signOutUrl, {
            method: "post",
            credentials: "include",
            headers:
                AuthHttpRequest.signoutAPICustomHeaders === undefined
                    ? undefined
                    : {
                          ...AuthHttpRequest.signoutAPICustomHeaders
                      }
        });

        if (resp.status === AuthHttpRequest.sessionExpiredStatusCode) {
            return;
        }

        if (resp.status >= 300) {
            throw resp;
        }
    }

    /**
     * @description sends the actual http request and returns a response if successful/
     * If not successful due to session expiry reasons, it
     * attempts to call the refresh token API and if that is successful, calls this API again.
     * @throws Error
     */
    private static doRequest = async (
        httpCall: (config?: RequestInit) => Promise<Response>,
        config?: RequestInit,
        url?: any
    ): Promise<Response> => {
        if (!AuthHttpRequest.initCalled) {
            throw Error("init function not called");
        }

        let doNotDoInterception = false;
        try {
            doNotDoInterception =
                (typeof url === "string" &&
                    normaliseURLDomainOrThrowError(url) !== AuthHttpRequest.apiDomain &&
                    AuthHttpRequest.addedFetchInterceptor) ||
                (url !== undefined &&
                typeof url.url === "string" && // this is because url can be an object like {method: ..., url: ...}
                    normaliseURLDomainOrThrowError(url.url) !== AuthHttpRequest.apiDomain &&
                    AuthHttpRequest.addedFetchInterceptor);
        } catch (err) {
            if (err.message === "Please provide a valid domain name") {
                // .origin gives the port as well..
                doNotDoInterception =
                    normaliseURLDomainOrThrowError(window.location.origin) !== AuthHttpRequest.apiDomain &&
                    AuthHttpRequest.addedFetchInterceptor;
            } else {
                throw err;
            }
        }

        if (doNotDoInterception) {
            return await httpCall(config);
        }

        if (AuthHttpRequest.addedFetchInterceptor) {
            ProcessState.getInstance().addState(PROCESS_STATE.CALLING_INTERCEPTION_REQUEST);
        }
        try {
            let throwError = false;
            let returnObj = undefined;
            while (true) {
                // we read this here so that if there is a session expiry error, then we can compare this value (that caused the error) with the value after the request is sent.
                // to avoid race conditions
                const preRequestIdToken = getIdRefreshToken();
                const antiCsrfToken = AntiCsrfToken.getToken(preRequestIdToken);
                let configWithAntiCsrf: RequestInit | undefined = config;
                if (antiCsrfToken !== undefined) {
                    configWithAntiCsrf = {
                        ...configWithAntiCsrf,
                        headers:
                            configWithAntiCsrf === undefined
                                ? {
                                      "anti-csrf": antiCsrfToken
                                  }
                                : {
                                      ...configWithAntiCsrf.headers,
                                      "anti-csrf": antiCsrfToken
                                  }
                    };
                }

                if (AuthHttpRequest.autoAddCredentials) {
                    if (configWithAntiCsrf === undefined) {
                        configWithAntiCsrf = {
                            credentials: "include"
                        };
                    } else if (configWithAntiCsrf.credentials === undefined) {
                        configWithAntiCsrf = {
                            ...configWithAntiCsrf,
                            credentials: "include"
                        };
                    }
                }
                try {
                    let response = await httpCall(configWithAntiCsrf);
                    response.headers.forEach((value: any, key: any) => {
                        if (key.toString() === "id-refresh-token") {
                            setIdRefreshToken(value);
                        }
                    });
                    if (response.status === AuthHttpRequest.sessionExpiredStatusCode) {
                        let retry = await handleUnauthorised(
                            AuthHttpRequest.refreshTokenUrl,
                            preRequestIdToken,
                            AuthHttpRequest.sessionScope,
                            AuthHttpRequest.refreshAPICustomHeaders,
                            AuthHttpRequest.sessionExpiredStatusCode
                        );
                        if (!retry) {
                            returnObj = response;
                            break;
                        }
                    } else {
                        response.headers.forEach((value, key) => {
                            if (key.toString() === "anti-csrf") {
                                AntiCsrfToken.setItem(getIdRefreshToken(), value);
                            } else if (key.toString() === "front-token") {
                                FrontToken.setItem(value);
                            }
                        });
                        return response;
                    }
                } catch (err) {
                    if (err.status === AuthHttpRequest.sessionExpiredStatusCode) {
                        let retry = await handleUnauthorised(
                            AuthHttpRequest.refreshTokenUrl,
                            preRequestIdToken,
                            AuthHttpRequest.sessionScope,
                            AuthHttpRequest.refreshAPICustomHeaders,
                            AuthHttpRequest.sessionExpiredStatusCode
                        );
                        if (!retry) {
                            throwError = true;
                            returnObj = err;
                            break;
                        }
                    } else {
                        throw err;
                    }
                }
            }
            // if it comes here, means we breaked. which happens only if we have logged out.
            if (throwError) {
                throw returnObj;
            } else {
                return returnObj;
            }
        } finally {
            if (getIdRefreshToken() === undefined) {
                AntiCsrfToken.removeToken();
                FrontToken.removeToken();
            }
        }
    };

    /**
     * @description attempts to refresh session regardless of expiry
     * @returns true if successful, else false if session has expired. Wrapped in a Promise
     * @throws error if anything goes wrong
     */
    static attemptRefreshingSession = async (): Promise<boolean> => {
        if (!AuthHttpRequest.initCalled) {
            throw Error("init function not called");
        }
        try {
            const preRequestIdToken = getIdRefreshToken();
            return await handleUnauthorised(
                AuthHttpRequest.refreshTokenUrl,
                preRequestIdToken,
                AuthHttpRequest.sessionScope,
                AuthHttpRequest.refreshAPICustomHeaders,
                AuthHttpRequest.sessionExpiredStatusCode
            );
        } finally {
            if (getIdRefreshToken() === undefined) {
                AntiCsrfToken.removeToken();
                FrontToken.removeToken();
            }
        }
    };

    private static fetch = async (url: RequestInfo, config?: RequestInit) => {
        return await AuthHttpRequest.doRequest(
            (config?: RequestInit) => {
                return AuthHttpRequest.originalFetch(url, {
                    ...config
                });
            },
            config,
            url
        );
    };

    static doesSessionExist = () => {
        return getIdRefreshToken() !== undefined;
    };
}

const ID_REFRESH_TOKEN_NAME = "sIRTFrontend";
const ANTI_CSRF_NAME = "sAntiCsrf";
const FRONT_TOKEN_NAME = "sFrontToken";

/**
 * @description attempts to call the refresh token API each time we are sure the session has expired, or it throws an error or,
 * or the ID_COOKIE_NAME has changed value -> which may mean that we have a new set of tokens.
 */
export async function onUnauthorisedResponse(
    refreshTokenUrl: string,
    preRequestIdToken: string,

    // @ts-ignore
    sessionScope: string,
    refreshAPICustomHeaders: any,
    sessionExpiredStatusCode: number
): Promise<{ result: "SESSION_EXPIRED" } | { result: "API_ERROR"; error: any } | { result: "RETRY" }> {
    let lock = new Lock();
    while (true) {
        if (await lock.acquireLock("REFRESH_TOKEN_USE", 1000)) {
            // to sync across tabs. the 1000 ms wait is for how much time to try and azquire the lock.
            try {
                let postLockID = getIdRefreshToken();
                if (postLockID === undefined) {
                    return { result: "SESSION_EXPIRED" };
                }
                if (postLockID !== preRequestIdToken) {
                    // means that some other process has already called this API and succeeded. so we need to call it again
                    return { result: "RETRY" };
                }
                const antiCsrfToken = AntiCsrfToken.getToken(preRequestIdToken);
                let headers: any = {
                    ...refreshAPICustomHeaders
                };
                if (antiCsrfToken !== undefined) {
                    headers = {
                        ...headers,
                        "anti-csrf": antiCsrfToken
                    };
                }
                headers = {
                    ...headers,
                    "fdi-version": supported_fdi.join(",")
                };
                let response = await AuthHttpRequest.originalFetch(refreshTokenUrl, {
                    method: "post",
                    credentials: "include",
                    headers
                });
                let removeIdRefreshToken = true;
                response.headers.forEach((value: any, key: any) => {
                    if (key.toString() === "id-refresh-token") {
                        setIdRefreshToken(value);
                        removeIdRefreshToken = false;
                    }
                });
                if (response.status === sessionExpiredStatusCode) {
                    // there is a case where frontend still has id refresh token, but backend doesn't get it. In this event, session expired error will be thrown and the frontend should remove this token
                    if (removeIdRefreshToken) {
                        setIdRefreshToken("remove");
                    }
                }
                if (response.status >= 300) {
                    throw response;
                }
                if (getIdRefreshToken() === undefined) {
                    // removed by server. So we logout
                    return { result: "SESSION_EXPIRED" };
                }
                response.headers.forEach((value: any, key: any) => {
                    if (key.toString() === "anti-csrf") {
                        AntiCsrfToken.setItem(getIdRefreshToken(), value);
                    } else if (key.toString() === "front-token") {
                        FrontToken.setItem(value);
                    }
                });
                return { result: "RETRY" };
            } catch (error) {
                if (getIdRefreshToken() === undefined) {
                    // removed by server.
                    return { result: "SESSION_EXPIRED" };
                }
                return { result: "API_ERROR", error };
            } finally {
                lock.releaseLock("REFRESH_TOKEN_USE");
            }
        }
        let idCookieValue = getIdRefreshToken();
        if (idCookieValue === undefined) {
            // removed by server. So we logout
            return { result: "SESSION_EXPIRED" };
        } else {
            if (idCookieValue !== preRequestIdToken) {
                return { result: "RETRY" };
            }
            // here we try to call the API again since we probably failed to acquire lock and nothing has changed.
        }
    }
}

export function getIdRefreshToken(): string | undefined {
    let fromLocalstorage = getWindowOrThrow().localStorage.getItem(ID_REFRESH_TOKEN_NAME);
    if (fromLocalstorage !== null) {
        let splitted = fromLocalstorage.split(";");
        let value = splitted[0];
        let expires = Number(splitted[1]);
        if (expires < Date.now()) {
            setIdRefreshToken("remove");
            value = undefined;
        }
        return value;
    }

    // for backwards compatibility
    function getIDFromCookieOld(): string | undefined {
        let value = "; " + getWindowOrThrow().document.cookie;
        let parts = value.split("; " + ID_REFRESH_TOKEN_NAME + "=");
        if (parts.length >= 2) {
            let last = parts.pop();
            if (last !== undefined) {
                return last.split(";").shift();
            }
        }
        return undefined;
    }
    let fromCookie = getIDFromCookieOld();
    if (fromCookie !== undefined) {
        setIdRefreshToken(fromCookie + ";9999999999999");
    }
    return fromCookie;
}

export function setIdRefreshToken(idRefreshToken: string) {
    if (idRefreshToken === "remove") {
        getWindowOrThrow().localStorage.removeItem(ID_REFRESH_TOKEN_NAME);
    } else {
        getWindowOrThrow().localStorage.setItem(ID_REFRESH_TOKEN_NAME, idRefreshToken);
    }

    // for backwards compatibility
    function setIDToCookieOld(idRefreshToken: string, domain: string) {
        let expires = "Thu, 01 Jan 1970 00:00:01 GMT";
        let cookieVal = "";
        if (idRefreshToken !== "remove") {
            let splitted = idRefreshToken.split(";");
            cookieVal = splitted[0];
            expires = new Date(Number(splitted[1])).toUTCString();
        }
        if (domain === "localhost" || domain === window.location.hostname) {
            // since some browsers ignore cookies with domain set to localhost
            // see https://github.com/supertokens/supertokens-website/issues/25
            getWindowOrThrow().document.cookie = `${ID_REFRESH_TOKEN_NAME}=${cookieVal};expires=${expires};path=/`;
        } else {
            getWindowOrThrow().document.cookie = `${ID_REFRESH_TOKEN_NAME}=${cookieVal};expires=${expires};domain=${domain};path=/`;
        }
    }
    setIDToCookieOld("remove", AuthHttpRequest.sessionScope);
}

function getAntiCSRFToken(): string | null {
    let fromLocalstorage = getWindowOrThrow().localStorage.getItem(ANTI_CSRF_NAME);
    if (fromLocalstorage !== null) {
        return fromLocalstorage;
    }

    // for backwards compatibility
    function getAntiCSRFromCookieOld(): string | null {
        let value = "; " + getWindowOrThrow().document.cookie;
        let parts = value.split("; " + ANTI_CSRF_NAME + "=");
        if (parts.length >= 2) {
            let last = parts.pop();
            if (last !== undefined) {
                let temp = last.split(";").shift();
                if (temp === undefined) {
                    return null;
                }
                return temp;
            }
        }
        return null;
    }
    let fromCookie = getAntiCSRFromCookieOld();
    if (fromCookie !== null) {
        setAntiCSRF(fromCookie);
    }
    return fromCookie;
}

// give antiCSRFToken as undefined to remove it.
export function setAntiCSRF(antiCSRFToken: string | undefined) {
    if (antiCSRFToken === undefined) {
        getWindowOrThrow().localStorage.removeItem(ANTI_CSRF_NAME);
    } else {
        getWindowOrThrow().localStorage.setItem(ANTI_CSRF_NAME, antiCSRFToken);
    }

    // for backwards compatibility
    function setAntiCSRFToCookieOld(antiCSRFToken: string | undefined, domain: string) {
        let expires: string | undefined = "Thu, 01 Jan 1970 00:00:01 GMT";
        let cookieVal = "";
        if (antiCSRFToken !== undefined) {
            cookieVal = antiCSRFToken;
            expires = undefined; // set cookie without expiry
        }
        if (domain === "localhost" || domain === window.location.hostname) {
            // since some browsers ignore cookies with domain set to localhost
            // see https://github.com/supertokens/supertokens-website/issues/25
            if (expires !== undefined) {
                getWindowOrThrow().document.cookie = `${ANTI_CSRF_NAME}=${cookieVal};expires=${expires};path=/`;
            } else {
                getWindowOrThrow().document.cookie = `${ANTI_CSRF_NAME}=${cookieVal};expires=Fri, 31 Dec 9999 23:59:59 GMT;path=/`;
            }
        } else {
            if (expires !== undefined) {
                getWindowOrThrow().document.cookie = `${ANTI_CSRF_NAME}=${cookieVal};expires=${expires};domain=${domain};path=/`;
            } else {
                getWindowOrThrow().document.cookie = `${ANTI_CSRF_NAME}=${cookieVal};domain=${domain};expires=Fri, 31 Dec 9999 23:59:59 GMT;path=/`;
            }
        }
    }
    setAntiCSRFToCookieOld(undefined, AuthHttpRequest.sessionScope);
}

export function getFrontToken(): string | null {
    let fromLocalstorage = getWindowOrThrow().localStorage.getItem(FRONT_TOKEN_NAME);
    if (fromLocalstorage !== null) {
        return fromLocalstorage;
    }

    // for backwards compatibility
    function getFrontTokenFromCookie(): string | null {
        let value = "; " + getWindowOrThrow().document.cookie;
        let parts = value.split("; " + FRONT_TOKEN_NAME + "=");
        if (parts.length >= 2) {
            let last = parts.pop();
            if (last !== undefined) {
                let temp = last.split(";").shift();
                if (temp === undefined) {
                    return null;
                }
                return temp;
            }
        }
        return null;
    }
    let fromCookie = getFrontTokenFromCookie();
    if (fromCookie !== null) {
        setFrontToken(fromCookie);
    }
    return fromCookie;
}

export function setFrontToken(frontToken: string | undefined) {
    if (frontToken === undefined) {
        getWindowOrThrow().localStorage.removeItem(FRONT_TOKEN_NAME);
    } else {
        getWindowOrThrow().localStorage.setItem(FRONT_TOKEN_NAME, frontToken);
    }

    // backwards compatibility
    function setFrontTokenToCookieOld(frontToken: string | undefined, domain: string) {
        let expires: string | undefined = "Thu, 01 Jan 1970 00:00:01 GMT";
        let cookieVal = "";
        if (frontToken !== undefined) {
            cookieVal = frontToken;
            expires = undefined; // set cookie without expiry
        }
        if (domain === "localhost" || domain === window.location.hostname) {
            // since some browsers ignore cookies with domain set to localhost
            // see https://github.com/supertokens/supertokens-website/issues/25
            if (expires !== undefined) {
                getWindowOrThrow().document.cookie = `${FRONT_TOKEN_NAME}=${cookieVal};expires=${expires};path=/`;
            } else {
                getWindowOrThrow().document.cookie = `${FRONT_TOKEN_NAME}=${cookieVal};expires=Fri, 31 Dec 9999 23:59:59 GMT;path=/`;
            }
        } else {
            if (expires !== undefined) {
                getWindowOrThrow().document.cookie = `${FRONT_TOKEN_NAME}=${cookieVal};expires=${expires};domain=${domain};path=/`;
            } else {
                getWindowOrThrow().document.cookie = `${FRONT_TOKEN_NAME}=${cookieVal};domain=${domain};expires=Fri, 31 Dec 9999 23:59:59 GMT;path=/`;
            }
        }
    }

    setFrontTokenToCookieOld(undefined, AuthHttpRequest.sessionScope);
}
