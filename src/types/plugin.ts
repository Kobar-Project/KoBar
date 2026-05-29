export interface PluginRegistryEntry {
    id: string;
    name: string;
    author: string;
    description: string;
    fullDescription: string;
    githubRepo: string;
    tags: string[];
    icon: string;
    color: string;
    version: string;
    downloads: string | number;
    rating?: string | number;
}
