// TODO: Ask why Umesh did all this

const caseInsensitiveOptions: Intl.CollatorOptions = { sensitivity: 'base' };

export function stringCompare(x: string | undefined, y: string | undefined, caseSensitive: boolean): number {
    if (x === undefined) {
         return y === undefined ? 0 : -1;  
    }
    if (y === undefined) {
        return 1;
    }       
    return caseSensitive ? x.localeCompare(y) : x.localeCompare(y, undefined, caseInsensitiveOptions);    
}

export function stringEquals(x: string | undefined, y: string | undefined, caseSensitive: boolean): boolean {
    return caseSensitive ? x === y : stringCompare(x, y, caseSensitive) === 0;    
}