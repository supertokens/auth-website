export default class AuthHttpRequest {
    static init(options: {
        refreshTokenUrl: string;
        websiteRootDomain?: string;
        refreshAPICustomHeaders?: any;
        sessionExpiredStatusCode?: number;
        autoAddCredentials?: boolean;
    }): void;
    static setAuth0API(apiPath: string): void;
    static getAuth0API: () => {
        apiPath: string | undefined;
    };
    static getRefreshURLDomain: () => string | undefined;
    static getUserId(): string;
    static getJWTPayloadSecurely(): Promise<any>;
    /**
     * @description attempts to refresh session regardless of expiry
     * @returns true if successful, else false if session has expired. Wrapped in a Promise
     * @throws error if anything goes wrong
     */
    static attemptRefreshingSession: () => Promise<boolean>;
    static doesSessionExist: () => boolean;
    static addAxiosInterceptors: (axiosInstance: any) => void;
}
export declare let init: typeof AuthHttpRequest.init;
export declare let setAuth0API: typeof AuthHttpRequest.setAuth0API;
export declare let getAuth0API: () => {
    apiPath: string | undefined;
};
export declare let getRefreshURLDomain: () => string | undefined;
export declare let getUserId: typeof AuthHttpRequest.getUserId;
export declare let getJWTPayloadSecurely: typeof AuthHttpRequest.getJWTPayloadSecurely;
export declare let attemptRefreshingSession: () => Promise<boolean>;
export declare let doesSessionExist: () => boolean;
export declare let addAxiosInterceptors: (axiosInstance: any) => void;
