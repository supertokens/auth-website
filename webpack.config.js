var webpack = require("webpack");
var path = require("path");

var BUILD_DIR = path.resolve(__dirname, "");
var APP_DIR = path.resolve(__dirname, "");
var version = JSON.stringify(require("./package.json").version);

var config = {
    entry: APP_DIR + "/lib/build/bundleEntry.js",
    output: {
        path: BUILD_DIR + "/bundle",
        filename: `bundle.js`,
        library: "supertokens"
    }
};

module.exports = config;
