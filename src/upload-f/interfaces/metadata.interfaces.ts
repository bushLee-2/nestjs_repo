interface Attribute {
  trait_type: string;
  value: any;
}

interface Metadata {
  title: string;
  description: string;
  url: string;
  attributes: Attribute[];
}
