"use strict";

/**
 * Starts the basic application.
 */
function initializeApplication() {
    const homeSection = document.querySelector("#home");

    if (!homeSection) {
        console.error("The home section could not be found.");
        return;
    }

    const statusMessage = document.createElement("p");

    statusMessage.classList.add("system-message");

    statusMessage.textContent =
        "HTML, CSS, and JavaScript loaded successfully.";

    homeSection.appendChild(statusMessage);

    console.log("Transport Request System started successfully.");
}

initializeApplication();