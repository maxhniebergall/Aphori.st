# 2002-react-window-infinite-loader

## Rule

USE react-window-infinite-loader with react-window WHEN implementing virtualized lists that need to lazy load data on scroll TO ensure optimal performance with minimal DOM nodes.

## Context

Long lists or tables can significantly impact application performance. Virtualization through `react-window` helps by only rendering visible items, but when combined with infinite loading, additional considerations are needed to properly implement the loading pattern.

## Documentation

### Installation

```bash
npm install react-window react-window-infinite-loader
# or
yarn add react-window react-window-infinite-loader
```

### Core Components

#### InfiniteLoader

The main component that wraps around a react-window List component.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `isItemLoaded` | Function | `(index: number) => boolean` - Should return `true` if the item at the specified index is loaded |
| `itemCount` | Number | Total number of items in the list (including items not yet loaded) |
| `loadMoreItems` | Function | `(startIndex: number, stopIndex: number) => Promise<void>` - Callback that returns a Promise that resolves when items have loaded |
| `children` | Function | Render prop that receives `{ onItemsRendered, ref }` which must be passed to the List component |
| `threshold` | Number | (Optional) Number of items to load beyond the visible window. Default is 15 |
| `minimumBatchSize` | Number | (Optional) Minimum number of items to load at a time. Default is 10 |

### Usage Example

```jsx
import React, { useState, useCallback } from 'react';
import { FixedSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';

const ListComponent = ({ items, moreItemsLoading, loadMore, hasNextPage }) => {
  // Calculate total items - add 1 if more items can be loaded
  const itemCount = hasNextPage ? items.length + 1 : items.length;
  
  // Check if item at index is loaded
  const isItemLoaded = useCallback(index => !hasNextPage || index < items.length, [hasNextPage, items.length]);
  
  // Render row based on loading state and item data
  const Row = ({ index, style }) => {
    const isLoading = !isItemLoaded(index);
    
    return (
      <div style={style}>
        {isLoading ? (
          <div>Loading...</div>
        ) : (
          <div>{items[index].name}</div> // Render your item based on your data
        )}
      </div>
    );
  };

  return (
    <InfiniteLoader
      isItemLoaded={isItemLoaded}
      itemCount={itemCount}
      loadMoreItems={loadMore}
    >
      {({ onItemsRendered, ref }) => (
        <FixedSizeList
          height={500}
          width={500}
          itemCount={itemCount}
          itemSize={50}
          onItemsRendered={onItemsRendered}
          ref={ref}
        >
          {Row}
        </FixedSizeList>
      )}
    </InfiniteLoader>
  );
};

export default ListComponent;
```

### Parent Component Example

```jsx
import React, { useState, useCallback } from 'react';
import ListComponent from './ListComponent';

const App = () => {
  const [items, setItems] = useState([]);
  const [moreItemsLoading, setMoreItemsLoading] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);
  
  const loadMore = useCallback(async (startIndex, stopIndex) => {
    setMoreItemsLoading(true);
    
    try {
      // Example API call to fetch more items
      const response = await fetch(`/api/items?start=${startIndex}&limit=${stopIndex - startIndex + 1}`);
      const newItems = await response.json();
      
      setItems(currentItems => [...currentItems, ...newItems]);
      
      // Check if we've reached the end of available data
      if (newItems.length < stopIndex - startIndex + 1) {
        setHasNextPage(false);
      }
    } catch (error) {
      console.error('Error loading more items:', error);
    } finally {
      setMoreItemsLoading(false);
    }
  }, []);
  
  return (
    <ListComponent
      items={items}
      moreItemsLoading={moreItemsLoading}
      loadMore={loadMore}
      hasNextPage={hasNextPage}
    />
  );
};

export default App;
```

## Best Practices

1. **Optimize the `isItemLoaded` method**: This function is called frequently during scrolling, so keep it as simple and efficient as possible.

2. **Handle loading states properly**: Always show loading indicators when fetching new data to provide clear feedback to users.

3. **Set appropriate `itemCount`**: The total should be the length of loaded items plus one (for the loading indicator) if more items can be loaded.

4. **Use `overscanCount` with care**: Adding a small overscan (3-5 items) prevents flash of empty content when scrolling, but overscanning too many items defeats the purpose of virtualization.

5. **Memoize row components and callbacks**: Use React.memo and useCallback to prevent unnecessary re-renders.

6. **Add error handling to loadMore function**: Always handle potential API failures gracefully.

7. **Cache loaded data**: Consider caching already loaded data to improve the user experience when they scroll back to previously viewed items.

8. **Adjust threshold based on item size**: For larger items, increase the `threshold` prop to start loading earlier before the user reaches the end.

9. **Set appropriate batch sizes**: Use `minimumBatchSize` to control how many items are loaded at once, balancing between too many small requests and too few large ones.

10. **Test on low-end devices**: Virtualization is especially important for performance on less powerful devices, so test your implementation across different device capabilities.

## References

1. [NPM Package: react-window-infinite-loader](https://www.npmjs.com/package/react-window-infinite-loader)
2. [Virtualize large lists with react-window](https://web.dev/articles/virtualize-long-lists-react-window) 