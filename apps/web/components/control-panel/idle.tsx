/** Nothing selected yet. Element selection from the iframe arrives in Phase 4. */
export function IdlePanel() {
  return (
    <p className="text-sm text-muted-foreground" data-testid="panel-idle">
      Nothing selected. Click a component in the preview to choose or generate
      an animation.
    </p>
  );
}
