One animation parameter: label · violet-filled track · number field. Stack with 14px gap.

```jsx
<Slider label="Duration" value={600} min={100} max={3000} step={50} unit="ms" />
<Slider label="Distance" value={24} max={200} unit="px" active />
```

Both inputs fire the same onChange with e.target.value.
