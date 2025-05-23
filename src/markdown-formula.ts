import { HyperFormula, SimpleCellAddress } from 'hyperformula';
import * as vscode from 'vscode';

// table struct
type TableCell = {
    line: number;
    column: number;
    content: string;
};

type TableStyle = {
    backgroundColor?: string;
    textColor?: string;
};

type TableStyleSelector = {
    selector: string;  // Can be 'table', 'header', 'row-{n}', 'col-{n}', 'cell-{row}-{col}'
    style: TableStyle;
};

type TableStyleConfig = {
    styles: TableStyleSelector[];
};

type TableContent = {
    sheet: string;
    data: TableCell[][];
    styles?: TableStyleConfig;
};

type FormulaReturn = {
    address: SimpleCellAddress[];
    locations: number[][];
    formulas: string[];
    data: string [][];
}

// return the locations of the found formulas and the replacement values
// locations: [lineNumber, column]
// data: [#val](##formula)
export type MarkdownReturn = {
    locations: number[];
    data: string;
}

// given the document, parse valid tables
export function MarkdownFormula(document:string, precisionRounding:number, includeTableHeaderInCellNumaration:boolean):MarkdownReturn[] {
    // split document into lines
    let allLines: string[] = document.split(/\r?\n/gm)

    // find the tables
    let tableCanditates = SplitValidMarkdownTables(allLines, includeTableHeaderInCellNumaration);

    // print the tables
    console.log("markdown-formula detected %d valid tables!", tableCanditates.length);

    // check the precision level
    if(precisionRounding < 0) {
        console.log("invalid precision level!");
        precisionRounding = 4;
    }

    // create hyperformula option
    const options = {
        precisionRounding: precisionRounding,
        licenseKey: 'gpl-v3',
        decimalSeparator: vscode.workspace.getConfiguration('markdown-formula').get('decimalSeparator', '.') as '.' | ',',
        thousandSeparator: vscode.workspace.getConfiguration('markdown-formula').get('thousandSeparator', ',') as ',' | '.' | ' ' | ''
    };

    // build an instance with defined options
    const hfInstance = HyperFormula.buildEmpty(options);

    // create output
    let output:MarkdownReturn[] = [];

    // formulas in table
    let allFormulaData: FormulaReturn[] = [];

    // create data pointer for table content
    for(let i = 0; i < tableCanditates.length; i++)
    {
        // add the current table to hfInstance
        const sheetNameI = hfInstance.addSheet(tableCanditates[i].sheet);
        const sheetIdI = hfInstance.getSheetId(sheetNameI);

        // not possible but ts forces this check
        if(typeof sheetIdI !== "undefined")
        {
            let formulaData = GetFormulaData(tableCanditates[i], sheetIdI);
            hfInstance.setSheetContent(sheetIdI, formulaData.data);
            allFormulaData.push(formulaData);
        }
    }

    // go over all formulas and get the results
    for(let k = 0; k < allFormulaData.length; k++)
    {
        // add the cell address to list
        for(let i = 0; i < allFormulaData[k].address.length; i++)
        {
            const val = hfInstance.getCellValue(allFormulaData[k].address[i]);
            let result = '[' + val + ']' + '(#' + allFormulaData[k].formulas[i] + ')';

            // push the result into output vector
            output.push({data:result, locations: allFormulaData[k].locations[i]});
        }
    }

    // return the result
    return output;
}

// split the table into columns
function GetFormulaData(table:TableContent, sheetID:number):FormulaReturn {

    // get the cells of the table
    let tableData = table.data;
    let output:FormulaReturn = {address:[], locations:[], formulas:[], data:[]};

    for(let r = 0; r < tableData.length; r++)
    {
        let rowRdata: string[] = [];

        // loop on the columns
        for(let c = 0; c < tableData[r].length; c++)
        {
            // get the content
            let content = tableData[r][c].content;

            // is formula?
            let formulaPattern = /\[.*?\]\(#(.*)\)/
            let match = content.match(formulaPattern);
            if(match != null && match.index)
            {
                output.address.push({ col: c, row: r, sheet: sheetID });
                output.locations.push([tableData[r][c].line, tableData[r][c].column + match.index, match[0].length]);
                output.formulas.push(match[1]);
                content = '=' + match[1];
            }

            // Apply cell styling
            content = applyCellStyles(content.trim(), table, r, c);

            // set the content
            rowRdata.push(content);
        }
        output.data.push(rowRdata);
    }

    // split the content into columns
    return output;
}

// returns all consecutive blocks in given array
// [1,2,4,5,6,7,9] => [[1,2],[4,5,6,7]]
function FindConsecutiveBlocks(array:number[]) {
    let consecutiveLineArray: number[][] = [];
    let consecutiveLines = [array[0]];

    // go over the all elements
    for (let k = 1; k < array.length; k++) {
        // if the current element matches the previous element in the block
        if ((consecutiveLines[consecutiveLines.length - 1] + 1) == array[k]) {
            consecutiveLines.push(array[k])
        } else {
            // if block contains at least two lines, accept it
            if (consecutiveLines.length >= 2) {
                consecutiveLineArray.push(consecutiveLines);
            }
            // restart the block since it is not consecutive anymore
            consecutiveLines = [array[k]]
        }
    }

    // add the last part if it is not empty
    if (consecutiveLines.length >= 2) {
        consecutiveLineArray.push(consecutiveLines);
    }

    return consecutiveLineArray;
}

// create array of table cells that contains the all the data in the row
function GetTableColumns(allContent:string[], lineNumber:number) {

    let column:TableCell[] = [];

    // get the cells
    let splits = allContent[lineNumber].split('|')

    // parse each column, skip first and last |
    var index=0
    for(let i = 1; i < splits.length - 1; i++) {
        column.push({line:lineNumber, column: index + 1, content:splits[i]});
        index += splits[i].length + 1;
    }

    // return the column
    return column;
}

// Modify the GetTableContent function to include styling
function GetTableContent(allLines:string[], dataLines:number[], sheetID:number, includeTableHeaderInCellNumaration:boolean)
{
    // create a table
    let table: TableContent = {sheet:'Sheet' + sheetID, data:[]};

    // Check for styles comment before the table
    if(dataLines[0] > 0) {
        // Look for styles in the lines before the table
        for(let i = dataLines[0] - 1; i >= Math.max(0, dataLines[0] - 3); i--) {
            const styles = parseTableStyles(allLines[i]);
            if (styles) {
                table.styles = styles;
                break;
            }
        }

        // Check for sheet name
        let sheetNamePattern = /<!--\s*sheet:\s*([^>]*)\s*-->/;
        let match = allLines[dataLines[0]-1].match(sheetNamePattern);
        if(match != null) {
            table.sheet = match[1];
        }
    }

    // push the table header to the data array
    if(includeTableHeaderInCellNumaration) {
        table.data.push(GetTableColumns(allLines, dataLines[0]));
    }

    // fill the table cells, skip the first two rows
    for(let i = 2; i < dataLines.length; i++)
    {
        table.data.push(GetTableColumns(allLines, dataLines[i]));
    }

    return table;
}

// splits the given document into smaller text groups that can be markdown tables
// returns an array of candidate table content and line numbers
function SplitValidMarkdownTables(allLines:string[], includeTableHeaderInCellNumaration:boolean) {

    let candidateLines: number[] = [];

    // check all the lines and test for table pattern
    let tablePattern = /^\|(.*)\|$/m
    for (let l = 0; l < allLines.length; l++) {
        if (tablePattern.test(allLines[l])) {
            candidateLines.push(l);
        }
    }

    // get the consecutive lines as arrays
    let blocks = FindConsecutiveBlocks(candidateLines);

    // create table object
    let tables: TableContent[] = [];

    // find the blocks that contains formulas
    for(let i = 0; i < blocks.length; i++)
    {
        // check that table contains |---****---| pattern
        if(allLines[blocks[i][1]].match(/(?:\|.+?[-]+.+?)+\|/))
        {
            // create table if table contains more than two rows (header and ----)
            if(blocks[i].length > 2)
            {
                tables.push(GetTableContent(allLines, blocks[i], tables.length, includeTableHeaderInCellNumaration));
            }
        }
    }

    // return the valid table
    return tables;
}

// Add new function to parse style comments
function parseTableStyles(commentLine: string): TableStyleConfig | undefined {
    try {
        // Match <!-- styles: {...} -->
        const styleMatch = commentLine.match(/<!--\s*styles:\s*(\{[\s\S]*?\})\s*-->/);
        if (!styleMatch) return undefined;

        const stylesObj = JSON.parse(styleMatch[1]);
        return {
            styles: Array.isArray(stylesObj) ? stylesObj : []
        };
    } catch (e) {
        console.error('Error parsing table styles:', e);
        return undefined;
    }
}

// Add function to apply styles to a cell
function applyCellStyles(content: string, table: TableContent, rowIndex: number, colIndex: number): string {
    if (!table.styles?.styles.length) {
        return content;
    }

    const applicableStyles = table.styles.styles.filter(style => {
        const selector = style.selector;
        return (
            selector === 'table' ||
            (selector === 'header' && rowIndex === 0) ||
            selector === `row-${rowIndex}` ||
            selector === `col-${colIndex}` ||
            selector === `cell-${rowIndex}-${colIndex}`
        );
    });

    if (applicableStyles.length === 0) {
        return content;
    }

    // Merge all applicable styles
    const mergedStyle = applicableStyles.reduce((acc, curr) => ({
        backgroundColor: curr.style.backgroundColor || acc.backgroundColor,
        textColor: curr.style.textColor || acc.textColor
    }), {} as TableStyle);

    const styles = [];
    if (mergedStyle.backgroundColor) {
        styles.push(`background-color: ${mergedStyle.backgroundColor}`);
    }
    if (mergedStyle.textColor) {
        styles.push(`color: ${mergedStyle.textColor}`);
    }

    if (styles.length > 0) {
        return `<span style="${styles.join('; ')}">${content}</span>`;
    }
    return content;
}
