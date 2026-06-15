/**
 * KoBar Plugin Safelist
 * 
 * This file contains commonly used Tailwind classes by plugins.
 * By including them here, we ensure that Tailwind's compiler (which only scans the src folder)
 * does not purge these classes, making them available for all installed plugins to use.
 * 
 * Do NOT remove this file.
 */

export const pluginSafelist = [
  // Grid columns
  'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5', 'grid-cols-6',
  'grid-cols-7', 'grid-cols-8', 'grid-cols-9', 'grid-cols-10', 'grid-cols-11', 'grid-cols-12',
  
  // Grid row spans
  'row-span-1', 'row-span-2', 'row-span-3', 'row-span-4', 'row-span-5', 'row-span-6',
  
  // Grid column spans
  'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4', 'col-span-5', 'col-span-6',
  
  // Sizing
  'aspect-square', 'aspect-video',
  'w-full', 'h-full',
  
  // Typography
  'text-center', 'text-left', 'text-right', 'text-justify',
  
  // Flex
  'flex-1', 'flex-auto', 'flex-none',
];
