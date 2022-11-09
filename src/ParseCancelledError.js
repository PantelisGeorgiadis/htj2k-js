class ParseCancelledError extends Error {
    constructor() {
        super("Parsing has been cancelled")
        this.name = "ParseCancelledError"
    }
}

module.exports = ParseCancelledError