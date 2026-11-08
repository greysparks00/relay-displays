export function render(view, screen) {
    view.querySelector('[data-option="1"]').textContent = screen.option1;
    view.querySelector('[data-option="2"]').textContent = screen.option2;
}
