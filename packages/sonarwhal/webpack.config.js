const webpack = require('webpack');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = () => {
    return {
        entry: {cli: './src/bin/sonarwhal'},
        externals: [
            'browserslist',
            'encoding',
            'require-uncached',
            'update-notifier'
        ],
        mode: 'development',
        module: {
            rules: [
                {
                    test: /\.ts$/, use: [
                        {loader: 'ts-loader'}
                    ]
                }
            ]
        },
        plugins: [
            new webpack.ProgressPlugin(),
            new ForkTsCheckerWebpackPlugin()
        ],
        resolve: {
            alias: {handlebars: 'handlebars/dist/handlebars.js'},
            extensions: ['.ts', '.wasm', '.mjs', '.js', '.json']
        },
        target: 'node'
    };
};
