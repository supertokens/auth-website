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
let SuperTokens = require("supertokens-node");
let express = require("express");
let cookieParser = require("cookie-parser");
let bodyParser = require("body-parser");
let http = require("http");
let { startST, stopST, killAllST, setupST, cleanST, setKeyValueInConfig } = require("./utils");
let { package_version } = require("../../lib/build/version");
let noOfTimesRefreshCalledDuringTest = 0;
let noOfTimesGetSessionCalledDuringTest = 0;

let urlencodedParser = bodyParser.urlencoded({ limit: "20mb", extended: true, parameterLimit: 20000 });
let jsonParser = bodyParser.json({ limit: "20mb" });

let app = express();
app.use(urlencodedParser);
app.use(jsonParser);
app.use(cookieParser());

SuperTokens.init({
    hosts: "http://localhost:9000",
    cookieSameSite: "lax",
    refreshTokenPath: "/auth/session/refresh"
});

app.options("*", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.header("Access-Control-Allow-Headers", "content-type");
    res.header("Access-Control-Allow-Methods", "*");
    SuperTokens.setRelevantHeadersForOptionsAPI(res);
    res.send("");
});

app.post("/login", async (req, res) => {
    let userId = req.body.userId;
    let session = await SuperTokens.createNewSession(res, userId);
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.header("Access-Control-Allow-Credentials", true);
    res.send(session.userId);
});

app.post("/startst", async (req, res) => {
    let accessTokenValidity = req.body.accessTokenValidity === undefined ? 1 : req.body.accessTokenValidity;
    let enableAntiCsrf = req.body.enableAntiCsrf === undefined ? true : req.body.enableAntiCsrf;
    await setKeyValueInConfig("access_token_validity", accessTokenValidity);
    await setKeyValueInConfig("enable_anti_csrf", enableAntiCsrf);
    let pid = await startST();
    res.send(pid + "");
});

app.post("/beforeeach", async (req, res) => {
    noOfTimesRefreshCalledDuringTest = 0;
    noOfTimesGetSessionCalledDuringTest = 0;
    await killAllST();
    await setupST();
    res.send();
});

app.post("/after", async (req, res) => {
    await killAllST();
    await cleanST();
    res.send();
});

app.post("/stopst", async (req, res) => {
    await stopST(req.body.pid);
    res.send("");
});

app.post("/testUserConfig", async (req, res) => {
    res.status(200).send();
});

app.post("/multipleInterceptors", async (req, res) => {
    res.status(200).send(
        req.headers.interceptorheader2 !== undefined && req.headers.interceptorheader1 !== undefined
            ? "success"
            : "failure"
    );
});

app.get("/", SuperTokens.middleware(true), async (req, res) => {
    noOfTimesGetSessionCalledDuringTest += 1;
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.header("Access-Control-Allow-Credentials", true);
    res.send(req.session.getUserId());
});

app.get("/update-jwt", SuperTokens.middleware(true), async (req, res) => {
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.header("Access-Control-Allow-Credentials", true);
    res.json(req.session.getJWTPayload());
});

app.post("/update-jwt", SuperTokens.middleware(true), async (req, res) => {
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.header("Access-Control-Allow-Credentials", true);
    await req.session.updateJWTPayload(req.body);
    res.json(req.session.getJWTPayload());
});

app.use("/testing", async (req, res) => {
    let tH = req.headers["testing"];
    if (tH !== undefined) {
        res.header("testing", tH);
    }
    res.send("success");
});

app.post("/logout", SuperTokens.middleware(), async (req, res) => {
    await req.session.revokeSession();
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.header("Access-Control-Allow-Credentials", true);
    res.send("success");
});

app.post("/revokeAll", SuperTokens.middleware(), async (req, res) => {
    let userId = req.session.getUserId();
    await SuperTokens.revokeAllSessionsForUser(userId);
    res.send("success");
});

app.post("/auth/session/refresh", SuperTokens.middleware(), async (req, res) => {
    refreshCalled = true;
    noOfTimesRefreshCalledDuringTest += 1;
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.header("Access-Control-Allow-Credentials", true);
    res.send("refresh success");
});

app.get("/refreshCalledTime", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
    res.status(200).send("" + noOfTimesRefreshCalledDuringTest);
});

app.get("/getSessionCalledTime", async (req, res) => {
    res.status(200).send("" + noOfTimesGetSessionCalledDuringTest);
});
app.get("/getPackageVersion", async (req, res) => {
    res.status(200).send("" + package_version);
});

app.get("/ping", async (req, res) => {
    res.send("success");
});

app.get("/testHeader", async (req, res) => {
    let testHeader = req.headers["st-custom-header"];
    let success = true;
    if (testHeader === undefined) {
        success = false;
    }
    let data = {
        success
    };
    res.send(JSON.stringify(data));
});

app.post("/checkAllowCredentials", (req, res) => {
    res.send(req.headers["allow-credentials"] !== undefined ? true : false);
});

app.get("/index.html", (req, res) => {
    res.sendFile("index.html", { root: __dirname });
});
app.get("/testError", (req, res) => {
    res.status(500).send("test error message");
});

app.get("/stop", async (req, res) => {
    process.exit();
});

app.use("*", async (req, res, next) => {
    res.status(404).send();
});

app.use(
    SuperTokens.errorHandler({
        onTryRefreshToken: (err, req, res) => {
            res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
            res.header("Access-Control-Allow-Credentials", true);
            res.status(401).send();
        },
        onUnauthorised: (err, req, res) => {
            res.header("Access-Control-Allow-Origin", "http://localhost.org:8080");
            res.header("Access-Control-Allow-Credentials", true);
            res.status(401).send();
        }
    })
);

app.use(async (err, req, res, next) => {
    res.send(500).send(err);
});

let server = http.createServer(app);
server.listen(process.env.NODE_PORT === undefined ? 8080 : process.env.NODE_PORT, "0.0.0.0");
