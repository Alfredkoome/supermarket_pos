
async function apiRequest(endpoint, options = {}) {

    try {

        const response = await fetch(`${API_BASE}${endpoint}`, {

            ...options,

            credentials: "include",

            headers: {
                "Content-Type": "application/json",
                ...options.headers
            }

        });

        const rawResponse = await response.text();

        let data = {};

        try {
            data = JSON.parse(rawResponse);
        } catch {
            data = { rawResponse };
        }

        if (!response.ok) {

            console.error("HTTP STATUS:", response.status);
            console.error("BACKEND RESPONSE:", data);

            throw new Error(
                data.message ||
                data.error ||
                data.rawResponse ||
                `Request failed: ${response.status}`
            );

        }

        return data;

    } catch (error) {

        console.error("API ERROR:", error);

        throw error;

    }

}


function getElement(selector) {

    return document.querySelector(selector);

}


function getElements(selector) {

    return document.querySelectorAll(selector);

}


function formatCurrency(amount) {

    return new Intl.NumberFormat("en-KE", {

        style: "currency",

        currency: "KES"

    }).format(Number(amount) || 0);

}


function showMessage(message) {

    alert(message);

}