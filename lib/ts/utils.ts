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

import NormalisedURLDomain from "./normalisedURLDomain";
import NormalisedURLPath from "./normalisedURLPath";
import { InputType, NormalisedInputType } from "./types";
export function isAnIpAddress(ipaddress: string) {
    return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
        ipaddress
    );
}

export function normaliseURLDomainOrThrowError(input: string): string {
    let str = new NormalisedURLDomain(input).getAsStringDangerous();
    return str;
}

export function normaliseURLPathOrThrowError(input: string): string {
    return new NormalisedURLPath(input).getAsStringDangerous();
}

export function normaliseSessionScopeOrThrowError(sessionScope: string): string {
    function helper(sessionScope: string): string {
        sessionScope = sessionScope.trim().toLowerCase();

        // first we convert it to a URL so that we can use the URL class
        if (sessionScope.startsWith(".")) {
            sessionScope = sessionScope.substr(1);
        }

        if (!sessionScope.startsWith("http://") && !sessionScope.startsWith("https://")) {
            sessionScope = "http://" + sessionScope;
        }

        try {
            let urlObj = new URL(sessionScope);
            sessionScope = urlObj.hostname;

            // remove leading dot
            if (sessionScope.startsWith(".")) {
                sessionScope = sessionScope.substr(1);
            }

            return sessionScope;
        } catch (err) {
            throw new Error("Please provide a valid sessionScope");
        }
    }

    function isAnIpAddress(ipaddress: string) {
        return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
            ipaddress
        );
    }

    let noDotNormalised = helper(sessionScope);

    if (noDotNormalised === "localhost" || isAnIpAddress(noDotNormalised)) {
        return noDotNormalised;
    }

    if (sessionScope.startsWith(".")) {
        return "." + noDotNormalised;
    }

    return noDotNormalised;
}

export function validateAndNormaliseInputOrThrowError(options: InputType): NormalisedInputType {
    let apiDomain = normaliseURLDomainOrThrowError(options.apiDomain);

    let apiBasePath = normaliseURLPathOrThrowError("/auth");
    if (options.apiBasePath !== undefined) {
        apiBasePath = normaliseURLPathOrThrowError(options.apiBasePath);
    }

    let sessionScope = normaliseSessionScopeOrThrowError(getWindowOrThrow().location.hostname);
    if (options.sessionScope !== undefined) {
        sessionScope = normaliseSessionScopeOrThrowError(options.sessionScope);
    }

    let refreshAPICustomHeaders = {};
    if (options.refreshAPICustomHeaders !== undefined) {
        refreshAPICustomHeaders = options.refreshAPICustomHeaders;
    }

    let sessionExpiredStatusCode = 401;
    if (options.sessionExpiredStatusCode !== undefined) {
        sessionExpiredStatusCode = options.sessionExpiredStatusCode;
    }

    let autoAddCredentials = true;
    if (options.autoAddCredentials !== undefined) {
        autoAddCredentials = options.autoAddCredentials;
    }

    let isInIframe = false;
    if (options.isInIframe !== undefined) {
        isInIframe = options.isInIframe;
    }

    let cookieDomain: string | undefined = undefined;
    if (options.cookieDomain !== undefined) {
        cookieDomain = normaliseSessionScopeOrThrowError(options.cookieDomain);
    }

    return {
        apiDomain,
        apiBasePath,
        sessionScope,
        refreshAPICustomHeaders,
        sessionExpiredStatusCode,
        autoAddCredentials,
        isInIframe,
        cookieDomain
    };
}

export function getWindowOrThrow(): any {
    if (typeof window === "undefined") {
        throw Error(
            "If you are using this package with server-side rendering, please make sure that you are checking if the window object is defined."
        );
    }

    return window;
}

export function shouldDoInterceptionBasedOnUrl(
    toCheckUrl: string,
    apiDomain: string,
    cookieDomain: string | undefined
): boolean {
    function isNumeric(str: any) {
        if (typeof str != "string") return false; // we only process strings!
        return (
            !isNaN(str as any) && !isNaN(parseFloat(str)) // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
        ); // ...and ensure strings of whitespace fail
    }
    toCheckUrl = normaliseURLDomainOrThrowError(toCheckUrl);
    let urlObj = new URL(toCheckUrl);
    let domain = urlObj.hostname;
    if (cookieDomain === undefined) {
        domain = urlObj.port === "" ? domain : domain + ":" + urlObj.port;
        apiDomain = normaliseURLDomainOrThrowError(apiDomain);
        let apiUrlObj = new URL(apiDomain);
        return domain === (apiUrlObj.port === "" ? apiUrlObj.hostname : apiUrlObj.hostname + ":" + apiUrlObj.port);
    } else {
        let normalisedCookieDomain = normaliseSessionScopeOrThrowError(cookieDomain);
        if (cookieDomain.split(":").length > 1) {
            // means port may provided
            let portStr = cookieDomain.split(":")[cookieDomain.split(":").length - 1];
            if (isNumeric(portStr)) {
                normalisedCookieDomain += ":" + portStr;
                domain = urlObj.port === "" ? domain : domain + ":" + urlObj.port;
            }
        }
        if (cookieDomain.startsWith(".")) {
            return ("." + domain).endsWith(normalisedCookieDomain);
        } else {
            return domain === normalisedCookieDomain;
        }
    }
}
