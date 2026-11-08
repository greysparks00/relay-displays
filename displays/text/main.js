export function render(view, screen) {
    view.querySelector(".text-display").textContent = screen.content;
}
