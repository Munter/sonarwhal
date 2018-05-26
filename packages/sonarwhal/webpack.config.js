const webpack = require('webpack');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

process.env.webpack = true; //eslint-disable-line

module.exports = () => {
    return {
        entry: { cli: './src/bin/sonarwhal' },
        // externals: [
        //     'browserslist',
        //     'encoding',
        //     'require-uncached',
        //     'update-notifier'
        // ],
        externals: {
            browserslist: 'browserslist',
            encoding: 'encoding',
            'require-uncached': 'commonjs require-uncached',
            'update-notifier': 'commonjs update-notifier'
        },
        mode: 'development',
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: [{ loader: 'ts-loader' }]
                },
                {
                    loader: 'handlebars-template-loader',
                    test: /\.hbs$/
                }
            ]
        },
        node: {
            __dirname: false,
            __filename: false,
            path: true,
            process: false
        },
        plugins: [
            new webpack.ProgressPlugin(),
            new ForkTsCheckerWebpackPlugin()
        ],
        resolve: {
            alias: { handlebars: 'handlebars/dist/handlebars.js' },
            extensions: ['.ts', '.wasm', '.mjs', '.js', '.json']
        },
        target: 'node'
    };
};
