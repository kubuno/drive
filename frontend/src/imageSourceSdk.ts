// The core's image-picker registry ships in @kubuno/sdk. The published types
// this module compiles against do not expose it yet, while the HOST provides it
// at runtime through the import map — so we reach it with a narrow cast.
// Replace this file with a direct import once @kubuno/sdk is published & bumped.
import * as sdk from '@kubuno/sdk'
import type { ComponentType, ReactNode } from 'react'

export interface ImageSourceProps {
  onPick: (result: { kind: 'url'; url: string } | { kind: 'file'; file: File }) => void
  query: string
}

export interface ImageSource {
  id:    string
  label: string
  icon:  ReactNode
  order?: number
  searchable?: boolean
  searchPlaceholder?: string
  group?: 'library' | 'device'
  Component: ComponentType<ImageSourceProps>
}

export const ImageSourceRegistry = (sdk as unknown as {
  ImageSourceRegistry?: { add: (s: ImageSource) => void; remove: (id: string) => void }
}).ImageSourceRegistry
