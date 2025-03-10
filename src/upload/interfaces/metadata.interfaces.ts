export interface Attribute {
  trait_type: string;
  value: any;
}

export interface Metadata {
  title: string;
  description: string;
  url: string;
  attributes: Attribute[];
}
