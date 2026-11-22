window.POS_API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;

window.posApiFetch = (input, options = {}) =>
    window.fetch(input, {
        ...options,
        credentials: options.credentials ?? "include"
    });
