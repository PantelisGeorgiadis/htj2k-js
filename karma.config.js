module.exports = function (config) {
  config.set({
    frameworks: ['browserify', 'mocha', 'chai'],
    files: ['test/**/*.test.js'],
    preprocessors: {
      'test/**/*.test.js': 'browserify',
    },
    reporters: ['mocha'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    browsers: ['ChromeHeadless'],
    autoWatch: false,
    singleRun: true,
    concurrency: Infinity,
  });
};
