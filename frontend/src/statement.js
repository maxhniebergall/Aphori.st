import murmurhash3_32_gc from murmurhash3_32_gc

export class Statement {
    
    fromDatabase(uuid, body){
        let returnable = Statement();

        returnable.userName = body.userName;
        returnable.statementText = body.statementText;
        returnable.creationTime = body.creationTime;
        returnable.uuid = body.uuid;
        returnable.tags = body.tags;
        returnable.children = body.children;
        returnable.parents = body.parents;
        
        return returnable;
    }

    newStatement(userName, statementText, tags, parent){
        let returnable = Statement();

        returnable.userName = userName;
        returnable.statementText = statementText;
        returnable.tags = tags;
        returnable.parents = parent != null ? [parent] : [];
        returnable.creationTime = (performance.now() + performance.timeOrigin);
        returnable.children = [];
        returnable.uuid = uuid;

        return returnable;
    }

    addChild(child){
        this.children.push(child)
    }

    addParent(parent){
        this.parents.push(parent)
    }

    toJson(){
        JSON.stringify(this)
    }
}