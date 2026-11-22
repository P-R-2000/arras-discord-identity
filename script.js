// ==UserScript==
// @name         Arras Discord Username Identity
// @namespace    http://tampermonkey.net/
// @version      1.2
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
const userPromises = new Map();

arras.server.on("m", ({ message }) => {
    const matches = [...message.matchAll(/(<unknown>|@\S*) - (\d*)/g)];
    if (!matches.length) return;

    const promises = [];
    for (const match of matches) {
        const [original, name, id] = match;

        function putMessage(user) {
            message = message.replace(original, `${name} - \u3000 ${user.global_name} (@${user.username})${showId ? ` [${user.id}]` : ""}`);
        }
        function putErrorMessage() {
            message = message.replace(original, `${name} - ${id} [user not found]`);
        }

        const username = usernameCache.get(id);
        if (username) {
            putMessage(userCache.get(username));
        } else if (userPromises.has(id)) {
            promises.push(
                userPromises.get(id)
                    .then(user => {
                        if (user) putMessage(user)
                        else putErrorMessage();
                    })
            );
        } else {
            const req = fetch(`https://discord-user.pr2000.workers.dev/${id}`)
                .then(r => r.json())
                .then(async user => {
                    if (user.error) {
                        putErrorMessage();
                        return false;
                    }
                    const image = new Image();
                    image.crossOrigin = "anonymous";
                    image.src = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
                    await new Promise((resolve, reject) => {
                        image.addEventListener("load", () => {
                            imageCache.set(user.username, image);
                            userCache.set(user.username, user);
                            usernameCache.set(user.id, user.username);
                            userPromises.delete(id);
                            resolve();
                        });
                        image.addEventListener("error", () => {
                            reject();
                        })
                    });
                    putMessage(user);
                    return user;
                })
                .catch(() => {
                    putErrorMessage();
                    return false;
                });
            userPromises.set(id, req);
            promises.push(req);
        }
    }

    if (promises.length) {
        Promise.all(promises)
            .then(() => {
                arras.server.send("m", { message });
            });
        return false;
    } else return { message };
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