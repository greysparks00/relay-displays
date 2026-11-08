export function render(view, data) {
    const display = view.querySelector(".text-display")
    if (!display) return;

    display.textContent = data.content;

    const START_DELAY = 3000;
    const BOTTOM_DELAY = 2000;
    const SCROLL_SPEED = 26;
    const FADE_DURATION = 450;

    let frameId = null;
    let timerId = null;
    let updateTimer = null;
    let cycleId = 0;

    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );

    function stopCycle() {
        cycleId++;

        cancelAnimationFrame(frameId);
        clearTimeout(timerId);
        clearTimeout(updateTimer);

        display.classList.remove("is-resetting");
    }

    function startCycle() {
        stopCycle();

        display.scrollTop = 0;

        const overflow = display.scrollHeight - display.clientHeight;

        if (overflow <= 1 || reducedMotion.matches) {
            return;
        }

        const currentCycle = cycleId;

        timerId = setTimeout(() => {
            scrollText(currentCycle);
        }, START_DELAY);
    }

    function scrollText(currentCycle) {
        let lastTime = null;
        let position = display.scrollTop;

        function animate(time) {
            if (currentCycle !== cycleId) {
                return;
            }

            if (lastTime === null) {
                lastTime = time;
            }

            const delta = Math.min(time - lastTime, 100);
            lastTime = time;

            const bottom = display.scrollHeight - display.clientHeight;

            position = Math.min(
                position + (delta / 1000) * SCROLL_SPEED,
                bottom
            );

            display.scrollTop = position;

            if (position < bottom - 1) {
                frameId = requestAnimationFrame(animate);
                return;
            }

            timerId = setTimeout(() => {
                if (currentCycle !== cycleId) return;

                display.classList.add("is-resetting");

                timerId = setTimeout(() => {
                    if (currentCycle !== cycleId) return;

                    display.scrollTop = 0;
                    display.classList.remove("is-resetting");

                    timerId = setTimeout(startCycle, START_DELAY);
                }, FADE_DURATION);

            }, BOTTOM_DELAY);
        }

        frameId = requestAnimationFrame(animate);
    }

    window.addEventListener("resize", () => {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(startCycle, 250);
    });

    requestAnimationFrame(() => {
        requestAnimationFrame(startCycle);
    });
}
