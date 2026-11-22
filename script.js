// ==UserScript==
// @name         Arras Discord Username Identity
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Shows discord username in player identity
// @author       pr2000
// @match        https://arras.io/
// @match        https://arrax.io/
// @match        https://arras.netlify.app/
// @match        https://arras.pages.dev/
// @match        https://arras-wwii.pages.dev/
// @icon         https://arras.io/favicon/64x64.png
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

let showId = GM_getValue("showId", false);

function updateShowIdMenu() {
    GM_registerMenuCommand(`Show User ID: ${showId ? "ON" : "OFF"}`, () => {
        showId = !showId;
        GM_setValue("showId", showId);
        updateShowIdMenu();
    }, {
        id: "showId",
        autoClose: false
    });
}
updateShowIdMenu();

const usernameCache = new Map();
const userCache = new Map();
const imageCache = new Map();
const promises = new Map();

arras.server.on("m", ({ message }) => {
    const match = message.match(/(<unknown>|@\S*) - (\d*)/m);
    if (!match) return;
    const [original, name, id] = match;
    if (!id) return;

    function getMessage(user) {
        return message.replace(original, `${name} - \u3000 ${user.global_name} (@${user.username})${showId ? ` [${user.id}]` : ""}`);
    }
    function getErrorMessage() {
        return message.replace(original, `${name} - ${id} [user not found]`);
    }

    const username = usernameCache.get(id);
    if (username) {
        return {
            message: getMessage(userCache.get(username))
        };
    } else if (promises.has(id)) {
        promises.get(id).then(() => {
            arras.server.send("m", {
                message: getMessage(response)
            });
        });
        return false;
    } else {
        promises.set(id,
            fetch(`https://discord-user.pr2000.workers.dev/${id}`)
                .then(r => r.json())
                .then(data => {
                    if (data.error) {
                        arras.server.send("m", {
                            message: getErrorMessage()
                        });
                        return;
                    }
                    const image = new Image();
                    image.crossOrigin = "anonymous";
                    image.src = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(data.id) >> 22n) % 6n}.png`;
                    image.addEventListener("load", () => {
                        usernameCache.set(data.id, data.username);
                        userCache.set(data.username, data);
                        imageCache.set(data.username, image);
                        promises.delete(id);
                        arras.server.send("m", {
                            message: getMessage(data)
                        });
                    });
                }).catch(e => {
                    arras.server.send("m", {
                        message: getErrorMessage()
                    });
                    console.error(e);
                    return;
                })
        );
        return false;
    }
});

const fillText = CanvasRenderingContext2D.prototype.fillText;
CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
    const imgIndex = text.indexOf("\u3000");

    if (imgIndex !== -1) {
        const match = text.match(/(?:<unknown>|@\S*) - \u3000 (.*) \(@([a-zA-Z0-9_.]*)\)/);

        if (match) {
            const [_, name, username] = match;
            const user = userCache.get(username);
            const image = imageCache.get(username);

            const { width, actualBoundingBoxAscent, actualBoundingBoxDescent } = this.measureText(text.slice(0, imgIndex));
            const height = actualBoundingBoxAscent + actualBoundingBoxDescent;
            const imgX = x + width;

            this.save();
            this.beginPath();
            this.arc(imgX + height / 2, y, height / 2, 0, Math.PI * 2);
            this.clip();

            this.drawImage(image, imgX, y - height / 2, height, height);

            this.restore();

            if (user.banner_color) {
                const firstPart = text.slice(0, imgIndex + 2);
                const secondPart = text.slice(imgIndex + 2 + name.length);

                fillText.call(this, firstPart, x, y, maxWidth);
                x += this.measureText(firstPart).width;

                const style = this.fillStyle;
                this.fillStyle = user.banner_color;
                fillText.call(this, name, x, y, maxWidth);
                this.fillStyle = style;
                x += this.measureText(name).width;

                fillText.call(this, secondPart, x, y, maxWidth);

                return;
            }
        }
    }
    return fillText.call(this, text, x, y, maxWidth);
}