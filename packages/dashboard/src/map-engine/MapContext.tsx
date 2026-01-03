/**
 * MapContext
 * React context for map controller dependency injection
 */

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { IMapController, ViewMode, MapProviderType } from './types';

interface MapContextValue {
  controller: IMapController | null;
  setController: (controller: IMapController | null) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  providerType: MapProviderType;
  setProviderType: (type: MapProviderType) => void;
}

const MapContext = createContext<MapContextValue | undefined>(undefined);

export function MapProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<IMapController | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('3d-local');
  const [providerType, setProviderType] = useState<MapProviderType>('three');

  return (
    <MapContext.Provider
      value={{
        controller,
        setController,
        viewMode,
        setViewMode,
        providerType,
        setProviderType,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext() {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error('useMapContext must be used within a MapProvider');
  }
  return context;
}
